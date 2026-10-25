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
