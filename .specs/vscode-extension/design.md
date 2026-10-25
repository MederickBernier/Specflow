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

## Spec loading

- `SpecService` wraps `loadSpecTree` with a VS Code `FileSystem` implementation over `workspace.fs`.
- A `FileSystemWatcher` on `.specs/**` triggers a debounced reload (300 ms).
- One `SpecService` per workspace folder that has specs; multi-root workspaces are supported but not optimized.

## Diagnostics

Two `DiagnosticCollection`s, `specflow-lint` and `specflow-drift`, so each can be cleared independently. `Finding.severity` maps directly to `DiagnosticSeverity`.

## Run flow

1. Command `specflow.runTask(feature, taskId)`.
2. `adapter.check()`; on failure show R8's message.
3. Confirmation quick pick unless `specflow.confirmRuns` is false.
4. Runner starts; `RunView` opens and renders events as they arrive.
5. On `finished` with `ok`, show the changed files in a tree under the run, each opening `vscode.diff(HEAD version, working file)` through the built-in Git extension API.
6. Accept runs `git commit -F` with the prepared message. Discard restores files with `git restore`, after a modal confirmation.

## RunView

A small webview, no framework: plain HTML and a message handler. Events are rendered as a list; `usage` shows in a footer. Cancel posts a message that aborts the run's `AbortController`.

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
