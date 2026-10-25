# workbench-ui: tasks

## T1: Webview build and panel shell [R1]
status: todo
files: packages/vscode/webview/**, packages/vscode/src/workbench/panel.ts, packages/vscode/src/extension.ts, packages/vscode/package.json, packages/vscode/tsconfig.json, packages/vscode/.vscodeignore
depends: vscode-extension/T10

`Specflow: Open workbench` opens one themed panel with five empty tabs under a strict CSP; a second call reveals it; tab and reload restore work; the `.vsix` contains the webview bundle.

## T2: Workbench state and message protocol [R1]
status: todo
files: packages/vscode/src/workbench/state.ts, packages/vscode/src/workbench/protocol.ts, packages/vscode/src/workbench/panel.ts, packages/vscode/webview/main.tsx
depends: T1

State is built from roots, insights, review and harness health without the VS Code API; spec and run changes reach the open panel within 1 second; malformed messages and unknown paths are dropped.

## T3: Overview tab [R2]
status: todo
files: packages/vscode/webview/overview.tsx, packages/vscode/webview/style.css, packages/vscode/src/workbench/state.ts
depends: T2

Counts, progress, lint, drift and harness health render per feature; load errors show; clicking a feature opens the filtered Board.

## T4: Task board [R3]
status: todo
files: packages/vscode/webview/board.tsx, packages/vscode/src/workbench/actions.ts, packages/vscode/src/workbench/state.ts
depends: T2

Columns by status, waiting badges from dependencies, feature filter; Run goes through `specflow.runTask` with confirmation and is disabled during a run or review.

## T5: Unified diff model in core [R4, R5]
status: todo
files: packages/core/src/diff/**, packages/core/src/index.ts, fixtures/diffs/**
depends: task-run/T7

`parseUnifiedDiff`, `readWorkingDiff` (with untracked files, never touching the index) and `readCommitDiff` pass on recorded patches and a fixture repo, including size limits.

## T6: Diff viewer component [R4, R5]
status: todo
files: packages/vscode/webview/diff-view.tsx, packages/vscode/webview/style.css
depends: T1, T5

Unified and split layouts with line numbers, placeholders for binary and too-large files, layout choice remembered.

## T7: Review tab [R4]
status: todo
files: packages/vscode/webview/review.tsx, packages/vscode/src/workbench/actions.ts, packages/vscode/src/workbench/state.ts, packages/vscode/src/workbench/panel.ts
depends: T2, T6, vscode-extension/T7

A staged run's files, counts, scope marks, spec notes and inline diffs show, update on edit, and accept or discard through the existing commands; idle, the working tree diff shows read only.

## T8: Trace tab [R5]
status: todo
files: packages/vscode/webview/trace.tsx, packages/vscode/src/workbench/state.ts, packages/vscode/src/workbench/actions.ts, packages/vscode/src/codelens.ts, packages/vscode/src/lens-titles.ts
depends: T2, T6, vscode-extension/T8

Picking a requirement or task shows its tasks and commits; a commit's diff renders inline; the requirement lens opens the workbench on it.

## T9: Drift ack in core and CLI [R7]
status: todo
files: packages/core/src/metadata.ts, packages/core/src/run/status.ts, packages/core/src/drift/ack.ts, packages/core/src/index.ts, packages/cli/src/commands/drift.ts
depends: drift-check/T6

`setTaskStatus` runs on `setMetadataLine` with its tests unchanged; `specflow drift ack` writes the full hash, changes no other line, and refuses unknown refs and commits.

## T10: Drift tab [R6]
status: todo
files: packages/vscode/webview/drift.tsx, packages/vscode/src/workbench/actions.ts, packages/vscode/src/workbench/state.ts
depends: T2, T6, T9

Findings grouped by requirement, Check drift with progress, commit diffs inline, acknowledge after confirmation; "not checked" when there are no results.

## T11: Workbench smoke tests and docs []
status: todo
files: packages/vscode/test/**, packages/vscode/README.md, packages/vscode/CHANGELOG.md
depends: T3, T4, T7, T8, T10

Smoke tests drive the workbench through `workbench.receive` on the fixture workspaces; the README documents the workbench.
