# workbench-ui: design

## Overview

The workbench is one `WebviewPanel` (`specflow.workbench`) in the editor area, built with Preact. The extension host owns all state and all actions; the webview only renders a state snapshot and posts intents back.

```
packages/core/src/
  diff/unified.ts      parse `git diff` / `git show` output into FileDiff[]
  diff/read.ts         readWorkingDiff, readCommitDiff (through Git and FileSystem)
  metadata.ts          setMetadataLine: shared by setTaskStatus and drift ack
  drift/ack.ts         ackDrift(fs, git, tree, ref, commit)

packages/vscode/scripts/build.mts  esbuild for the host and the webview, copies codicons
packages/vscode/src/workbench/
  html.ts              tab list and the page's HTML and CSP (no vscode API)
  panel.ts             WorkbenchPanel: creates/reveals the panel, restores it, message routing
  state.ts             buildWorkbenchState(...) -> WorkbenchState (no vscode API)
  protocol.ts          WorkbenchState and host -> page types; zod schemas for page -> host messages
  actions.ts           maps intents to existing commands and core calls

packages/vscode/webview/
  main.tsx             entry
  connection.tsx       asks for and receives the state, reports what it rendered
  app.tsx              tab bar and routing
  overview.tsx, board.tsx, review.tsx, trace.tsx, drift.tsx
  diff-view.tsx        unified and split rendering of a FileDiff
  style.css
```

## Build

- `scripts/build.mts` (run by `build` and, with `--minify`, by `package`) bundles the extension host as before, and a second esbuild entry bundles `webview/main.tsx` for the browser (`--format=iife --jsx=automatic --jsx-import-source=preact`) to `dist/webview.js`, and its CSS to `dist/webview.css`. `@vscode/codicons` CSS and font are copied to `dist/codicons/`.
- `webview/` has its own `tsconfig.json` (`lib: ["ES2023", "DOM"]`, `jsxImportSource: preact`) so DOM types never leak into the extension host code; `build` type-checks both. Vitest picks up the JSX settings from it.
- Dependencies: `preact` (runtime), `@vscode/codicons` (assets). Nothing else at runtime; the packaged `.vsix` stays under 400 KB (about 270 KB after T1, most of it the codicon font).

## Panel and security

- `Specflow: Open workbench` (`specflow.openWorkbench`, optional `{ tab, feature, ref }`) creates the panel once and reveals it afterwards; a button in the Specs view title runs it. `retainContextWhenHidden` is off; the webview saves `{ tab, filter, diffLayout }` with `vscode.setState`, and a `WebviewPanelSerializer` restores the panel after a reload.
- The page posts `{ type: "tab", tab }` whenever its tab changes (smoke tests use this to know the bundle ran under the CSP), and the host posts `{ type: "show", tab }` to switch tabs. The tab bar follows the ARIA tabs pattern: arrow keys, Home and End, one tab in the tab order.
- CSP: `default-src 'none'; script-src 'nonce-…'; style-src ${cspSource}; font-src ${cspSource}; img-src ${cspSource} data:`. `localResourceRoots` is `dist/` only.
- Colors come from VS Code's `--vscode-*` CSS variables; no theme of our own.
- Preact escapes all text. Diff lines, commit subjects and spec text are rendered as text nodes; `dangerouslySetInnerHTML` is not used.
- Every message from the webview is parsed with zod in `protocol.ts`; unknown or malformed ones are dropped. Paths in messages must be one of the files in the current state (review files, the commit's files), and commits must be hashes listed in the state, so a compromised page cannot open or diff arbitrary paths.

## State and updates

- `buildWorkbenchState` takes the loaded roots (tree or load error, lint findings), `Insights` (trace commits, drift), the review state (pending recording, outcome with scope and spec notes), harness health, and the selections the host keeps (trace target, open commit). It returns plain JSON, unit tested without VS Code.
- `WorkbenchState` and the other types the page sees live in `protocol.ts`, which imports nothing from the host, so the page type-checks against them without pulling in `vscode` or core; the page bundle never contains zod.
- The extension calls `workbench.changed()` on `SpecService.onDidChange`, workspace root changes, `Insights.onDidChange`, review changes, `RunController.onDidChange` and `onDidCheckHarness` (the last harness check is kept by `harness-health.ts`). While the panel is open this posts a new state, debounced at 100 ms (inside R1's 1 second with the 300 ms spec reload).
- The page starts over each time it is shown, so it posts `ready` on load and gets the state at once; after rendering a state it posts `{ type: "rendered", revision }`. Until the first state the panel says it is loading.
- Page messages other than `ready`, `tab` and `rendered` are intents (`command`, `run`, `open`, `openDiff`, `diff`); once validated they fire `onDidRequest`, where the tabs' actions handle them. Commits a page may ask for are those in the state: drift evidence now, trace commits once the Trace tab lists them.
- Diffs are not part of the main state. The webview asks for one (`{ type: "diff", source: "review" | "working" | "commit", path?, commit? }`) and the host answers with `{ type: "diff", key, files }`; the webview caches by key and drops the cache on the next state whose `revision` changed.

## Diffs

- `parseUnifiedDiff(text)` turns git's patch format into `FileDiff { path, from?, change: "added" | "modified" | "deleted" | "renamed", binary, oldMode?, newMode?, additions, deletions, hunks, tooLarge? }`, each hunk holding `{ oldStart, oldLines, newStart, newLines, section?, lines }` and each line `{ kind: "context" | "add" | "del", text, oldLine?, newLine?, noNewline? }`. Hunk lines are read by the counts in the hunk header, so content that looks like a header stays content. It handles renames (from `rename from/to` when there is no `---`/`+++`), mode changes, binary files, `\ No newline at end of file`, CRLF, the tab git appends to names with a space, and C-style quoted paths with octal UTF-8 bytes (`unquotePath`). Recorded patches live in `fixtures/diffs/`.
- Every git call forces the patch format the parser expects, whatever the user's config: `--no-color --no-ext-diff --no-textconv -M -U3 --src-prefix=a/ --dst-prefix=b/` (so `diff.noprefix`, `diff.mnemonicPrefix` and `color.diff` have no effect).
- `readWorkingDiff(git, fs, root, { paths? })` runs `git diff HEAD --relative` (the empty tree when there is no commit yet) with literal pathspecs, so paths are relative to the spec root, and adds untracked files listed by `git ls-files --others --exclude-standard -z` as all-added diffs read through `FileSystem`. Nothing touches the index (no `git add -N`, no `git status` refresh). In a staged review the run's files are staged, so `git diff HEAD` already includes added files.
- `readCommitDiff(git, root, hash)` runs `git show --format=`; a root commit shows every file as added. Anything but a hex hash is refused before git runs. Its paths are relative to the repository's top level, like trace commits.
- Limits (`diffLimits`): a `--numstat -z` pass runs first, and files with more than 5,000 changed lines are excluded from the patch (`:(exclude,literal)`) and returned as `tooLarge` with their counts, so they are never read. A file whose patch text is over 1 MB is also returned as `tooLarge`, and the result stops before 10 MB with `truncated: true`. Untracked files are checked with `FileSystem.size` before they are read; one over 1 MB or 5,000 lines is `tooLarge`, and one containing a NUL byte is binary. The result is `DiffResult { files, truncated }`, files sorted by path.
- `diff-view.tsx` renders a `FileDiff` (type-only import from core, so no core code enters the page bundle): a header with the change, the old and new path of a rename, and `+N −M`; then a table per file, unified (old and new line numbers, sign, text) or side by side (`splitRows`: context on both sides; each run of deletions next to the additions after it, a deletion after additions starting a new run; the shorter side left empty). Hunk headers show `@@ … @@` and git's section. A missing final newline gets a marker. Binary, too-large, rename-only and mode-only files get a one-line placeholder, with Open in VS Code diff when the caller passes `onOpenNative`. `useDiffLayout` keeps the layout in `setState` (`diffLayout`, unified by default) and `DiffLayoutSwitch` toggles it. Long runs of context are already trimmed by `-U3`. Colors come from the `diffEditor.*` and `gitDecoration.*` theme variables.
- Open in VS Code diff reuses `specflow.openDiff` for review and working files; for a commit it opens `vscode.diff` between `specflow-commit:` documents of `<hash>^:<path>` and `<hash>:<path>`.

## Tabs

- **Overview:** one card per feature (a button, opening the Board filtered to it): requirement and task counts by status, a `<progress>` of tasks done, drift count. Header: lint problem count, where a root that failed to load counts as one (Show problems), drift (count, or "not checked"; Check drift), harness health (Check harness). Several roots each get a heading. The Board filter is saved with the tab in `setState`.
- `{ type: "command", command }` runs one of a fixed set: `checkDrift`, `checkHarness`, `showProblems`, mapped to command IDs in `protocol.ts` (`workbenchCommands`) and run by `actions.ts` without arguments.
- **Board:** four columns by status. A card shows `T3`, title, feature (when not filtered), requirements, dependencies, and `Waiting on T2` when a dependency is not done. The host computes `waitingOn` per task: `depends:` refs, same feature or `feature/T`, resolved with `resolveRef`, that exist and are not done; unknown refs are left to lint. Run (`Run again` when done) calls `specflow.runTask` with `{ ref: { root, feature, id } }`, as the explorer's ▶ does; Open calls `specflow.show`. Run is disabled with a reason while a run is in progress or under review, and the host refuses those cases too. A feature filter (a select, saved with the tab) narrows the columns; a filter naming a feature that is gone shows everything. Status is not changed from the Board: specflow owns the status line and changes it only through runs.
- **Review:** the file list, then the diff of the selected file (all files expanded below 20 files), spec notes, and the Accept and commit / Discard changes buttons, which call `specflow.acceptRun` and `specflow.discardRun` so confirmation and refresh stay in one place. A `FileSystemWatcher` on the run's files refreshes the diff while under review. Idle, it shows the working tree diff without buttons.
- **Trace:** a picker over requirements and tasks; the host computes the trace with core's `trace` over `Insights`' commits. `specflow.showTrace` keeps its quick pick; the requirement CodeLens gains a second lens, `Open in workbench`, calling `specflow.openWorkbench({ tab: "trace", ref })`.
- **Drift:** findings from `Insights`, grouped by feature then requirement. Check drift calls `specflow.checkDrift`; the button shows a spinner until `Insights` changes. Acknowledge asks with a modal naming the requirement and commit, then calls core's `ackDrift`; the spec change goes through the normal spec reload.

## Drift ack

- `setMetadataLine(text, location, key, value)` generalizes the status-line edit from `run/status.ts`: replace the value of `key:` in the item's metadata block, or insert the line after the heading, keeping line endings and every other line. `setTaskStatus` is rewritten on top of it, with its tests unchanged.
- `ackDrift(fs, git, tree, ref, commit)` resolves the requirement, checks the commit with `git rev-parse --verify <commit>^{commit}`, and writes the full hash. It never commits; the human does.
- CLI: `specflow drift ack <ref> <commit>` calls it, prints the requirement and hash, and supports `--json`.

## Testing

- core: `parseUnifiedDiff` against recorded patches in `fixtures/diffs/` (rename, binary, no newline, CRLF, quoted path, mode change); `readWorkingDiff` and `readCommitDiff` on a fixture repo; `setMetadataLine` and `ackDrift` unit tests.
- extension host: `buildWorkbenchState` and the protocol parser are unit tested with Vitest, without VS Code.
- webview: components tested with Vitest in a `happy-dom` environment and `@testing-library/preact`: tab switching, board columns and waiting badges, diff rendering in both layouts, placeholders, keyboard focus order.
- smoke: the command opens one panel and reveals it on the second call; `activate` exposes `workbench.state` and `workbench.receive(message)` so smoke tests can assert on the posted state and drive intents (run from the board with the replay adapter, accept, ack) without reading the webview's DOM.

## Alternatives considered

- **React:** larger bundle and slower startup for no feature we need; Preact's API is the same.
- **Only VS Code's diff editor:** kept one click away, but it shows one file at a time and loses the run's context (scope warnings, spec notes, accept).
- **Changing status by dragging cards:** status is owned by runs (task-run/R7); a manual move would bypass the snapshot and restore logic. Revisit with a `specflow status` command.
- **Folding the RunView into the workbench:** possible later; the run stream stays in its own panel for now, so this feature does not touch task-run's view.
- **`retainContextWhenHidden`:** simpler but keeps the page in memory; state is small enough to restore.
