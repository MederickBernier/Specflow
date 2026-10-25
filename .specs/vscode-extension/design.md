# vscode-extension: design

## Overview

The extension imports `@specflow/core` and the adapters directly, in the extension host. No webview in v1 except the run output view.

```
extension.ts
  SpecService        loads SpecTree, watches .specs/**, emits onDidChange
  ExplorerProvider   TreeDataProvider over SpecTree
  Diagnostics        lint + drift findings -> DiagnosticCollection
  CodeLensProvider   task "Run" lens, requirement summary lens
  RunController      Runner + adapter, feeds RunView, handles review
  RunView            webview panel rendering the RunEvent stream
```

## Activation

- `activationEvents`: `workspaceContains:.specs/config.yml` and `workspaceContains:.specs/**/*.md`. Without specs the extension stays inactive until `Specflow: Initialize specs` runs.
- The context key `specflow.hasSpecs` is true when a `file:` workspace folder has a spec root; every command except `specflow.init` is shown in the palette only then, and init only when it is false.
- `specflow.init` runs `initSpecs` in the workspace folder (a picker when there are several), opens `product.md`, and returns the result so smoke tests can assert on it.
- Smoke tests run in a real VS Code through `@vscode/test-electron` (`pnpm --filter specflow-vscode test:smoke`), once on a workspace with specs and once without; CI runs them under `xvfb-run` on Linux. The runner clears `ELECTRON_RUN_AS_NODE`, which a VS Code terminal sets and which would make the test VS Code start as plain Node.

## Spec loading

- `SpecService` wraps `loadSpecTree` with `VsCodeFileSystem`, a `FileSystem` implementation over `workspace.fs` (`file:` URIs; core paths are `uri.fsPath` with forward slashes).
- A `FileSystemWatcher` on `.specs/**` (and on `specsDir/**` when config moves it) triggers a debounced reload (300 ms); `onDidChange` fires once per burst. The service keeps the last good tree and the last load error separately.
- `activate` returns `{ services }`, used by the smoke tests and later features. Services are created and disposed as spec roots appear and disappear (after init, or when workspace folders change).
- One `SpecService` per workspace folder that has specs; multi-root workspaces are supported but not optimized.

## Explorer

A `Specs` view in the Explorer sidebar (`specflow.specs`, shown when `specflow.hasSpecs`). `explorerNodes` builds the nodes without the VS Code API, so they are unit tested; `SpecExplorer` maps them to `TreeItem`s. One root shows its features at the top; several roots each get a folder node; a root that fails to load shows an error node. Features list requirements, then tasks, with codicons by status (tasks: `circle-large-outline`, `sync`, `pass`, `circle-slash`; requirements: `verified`, `edit`, `trash`). Clicking opens the item's file with the cursor on its heading. `Specflow: Refresh specs` reloads on demand.

## Diagnostics

Two `DiagnosticCollection`s, `specflow-lint` and `specflow-drift`, so each can be cleared independently. `Finding.severity` maps directly to `DiagnosticSeverity`; the rule ID is the diagnostic `code` and the source is `specflow`. Lint diagnostics are replaced on every `SpecService` change; the files each root reported are remembered so fixed problems disappear. A tree that fails to load is shown as one error on `.specs/config.yml`.

## Harness health

`checkHarness` resolves the adapter (`specflow.harness` overrides `harness.default`) and runs its `check()`. `harnessMessage` turns the result into a warning with an `Open install docs` button (opening `installUrl`), information for version warnings, or nothing. It runs in the background on activation (quiet on success) and from `Specflow: Check harness`, which returns the result. Notifications are never awaited, since their promise only settles when the user acts.

## Run flow

1. Command `specflow.runTask(feature, taskId)`: from a task node (inline ▶ and context menu), with arguments, or from the palette with a pick of open tasks.
2. `adapter.check()`; on failure show R8's message.
3. Confirmation (a modal naming task, harness and commit mode) unless `specflow.confirmRuns` is false. A dirty tree offers `Run anyway`, which retries with `allowDirty`.
4. Core's `runTask` (the same flow as `specflow run`) starts; `RunView` opens beside the editor and renders events as they arrive. `Specflow: Cancel run`, or the view's Cancel button, aborts it.
5. On `finished` with `ok` and a staged recording, the `Run review` view lists the changed files, each opening `vscode.diff(HEAD version, working file)`. The HEAD side comes from a `specflow-head:` content provider running `git show HEAD:<file>` (empty for added files), rather than the built-in Git extension's API, so review works when that extension is disabled.
6. Accept runs core's `acceptRecording`: `git commit -F - -- <run's files>` with the prepared message, so edits made while reviewing are included and other staged files are not. Discard runs `discardRecording` after a modal confirmation: tracked files go back to HEAD, added files are removed, `tasks.md` is unstaged and its status line restored from the snapshot. While a run is under review (`specflow.reviewing`), starting another run is refused.

## RunView

A small webview, no framework: plain HTML and a message handler. Events are rendered as a list; `usage` shows in a footer. Cancel posts a message that aborts the run's `AbortController`.

`run-view-model.ts` reduces events to a view state and renders it to escaped HTML without the VS Code API, so both are unit tested; the extension posts the rendered body and the page swaps it in. The page has a strict CSP with a nonce for its one script and style. After the run, the outcome (recording, scope warnings, spec notes) is shown under the events.

## CodeLens and trace

- Task headings in `tasks.md` get `$(play) Run T3` (or `Run T3 again` when done), calling `specflow.runTask`.
- Requirement headings in `requirements.md` get `N tasks · last commit YYYY-MM-DD · M drift findings`, calling `specflow.showTrace`, which lists the tasks and commits in a quick pick; picking a commit opens `git show --stat` through a `specflow-commit:` document.
- Commit and drift data come from `Insights`, a per-root cache of `readTraceCommits` and the rule-based `checkDrift`, refreshed on spec changes, after accept or discard, and on `Specflow: Refresh specs`. CodeLens requests only read the cache, so they never run git.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `specflow.confirmRuns` | true | Ask before each run |
| `specflow.driftOnSave` | false | Run the rule-based drift pass when a spec is saved |
| `specflow.harness` | "" | Overrides `config.yml` for this machine |

## Packaging

esbuild bundles to a single `dist/extension.js`. `vsce` and `ovsx` publish from CI on a version tag.

## Alternatives considered

- **Call the CLI as a subprocess instead of importing core:** cleaner isolation, slower and harder to stream. Kept as the model for the JetBrains shell, not used here.
- **A full webview UI (React) for the explorer:** nicer looking, but native tree views are faster and theme correctly. Revisit for post-v1 visuals.
