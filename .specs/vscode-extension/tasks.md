# vscode-extension: tasks

## T1: Extension skeleton and activation [R1]
status: todo
files: packages/vscode/package.json, packages/vscode/src/extension.ts
depends: core-spec-model/T7

Activates only on workspaces with specs; smoke test covers both cases.

## T2: SpecService with file watching [R2]
status: todo
files: packages/vscode/src/spec-service.ts
depends: T1

Saving a spec file fires `onDidChange` once after the debounce.

## T3: Spec explorer tree view [R2]
status: todo
files: packages/vscode/src/explorer.ts
depends: T2

Tree shows features, requirements and tasks with status icons; click opens the right line.

## T4: Lint diagnostics [R3]
status: todo
files: packages/vscode/src/diagnostics.ts
depends: T2, core-spec-model/T8

Broken fixture shows its findings in Problems; fixing and saving clears them.

## T5: Harness health check [R8]
status: todo
files: packages/vscode/src/harness-health.ts
depends: T1, task-run/T6

Missing binary shows the message and install button.

## T6: Run controller and RunView [R4]
status: todo
files: packages/vscode/src/run/**
depends: T5, task-run/T5

With the replay adapter: events render in order, cancel aborts, usage shows in the footer.

## T7: Review, accept and discard [R5]
status: todo
files: packages/vscode/src/run/review.ts
depends: T6, task-run/T7

Changed files open in the built-in diff editor; accept commits with trailers; discard restores after confirmation.

## T8: Task and requirement CodeLens [R4, R7]
status: todo
files: packages/vscode/src/codelens.ts
depends: T6, task-run/T9

Run lens on tasks; summary lens on requirements with tasks, last commit and drift count; click opens the trace.

## T9: Drift diagnostics [R6]
status: todo
files: packages/vscode/src/diagnostics.ts
depends: T4, drift-check/T7

Drift fixture findings appear on requirement headings; `driftOnSave` setting respected.

## T10: Command palette parity [R9]
status: todo
files: packages/vscode/package.json, packages/vscode/src/commands.ts
depends: T3, T7, T9

Every CLI command has a palette entry.

## T11: README, demo and publishing [R10]
status: todo
files: packages/vscode/README.md, .github/workflows/release.yml
depends: T10

Published to Marketplace and Open VSX from a tag; someone else installs and runs a task from the README alone.
