# Tech

## Stack

- TypeScript (strict, ES2023), Node 22.18 or later (runs `.ts` scripts without a loader)
- pnpm workspaces monorepo
- esbuild for the extension and webview bundles, tsc for library builds
- Preact for the workbench webview
- Vitest for unit and integration tests
- @vscode/test-electron for extension smoke tests
- GitHub Actions for CI, on Linux and Windows

## Packages

| Package | Role | May depend on |
| --- | --- | --- |
| `@specflow/core` | Spec model, lint, trace graph, drift rules, adapter interface, event model | remark, yaml, zod (`core/node` entry point also: simple-git) |
| `@specflow/adapter-claude-code` | Runs a task through Claude Code headless | core |
| `@specflow/cli` | Terminal front end | core, adapters, commander |
| `specflow-vscode` | VS Code shell | core, adapters, vscode API, preact (webview only) |

## Architecture rules

- `core` never imports `vscode`, never spawns processes, never reads environment variables directly. I/O goes through injected interfaces (`FileSystem`, `Git`, `Spawner`, `Clock`).
- The one exception is the `@specflow/core/node` entry point (`packages/core/src/node/`), which holds the Node implementations of those interfaces. Nothing else in `core` imports from it; shells (CLI, extension) construct the implementations and inject them.
- Adapters translate harness output into the normalized event model in `core`. Nothing outside an adapter knows harness-specific flags or formats.
- If a feature can live in `core`, it does. The CLI and the extension only parse input, call `core`, and render output.
- Every CLI command supports `--json` with a stable, versioned output schema. The extension may call `core` directly, but the JSON schema is the contract other shells use.

## Platforms

The tool runs on Linux, macOS, Windows, and WSL (including a WSL folder opened from Windows VS Code).

- Paths inside `core` are absolute and use forward slashes: `/home/me/repo`, `C:/repo`, `//wsl$/Ubuntu/home/me/repo`.
- `core` converts incoming paths with `toPosixPath` and builds paths with `joinPath` and `parentDir`, never `node:path`'s `posix` helpers, which collapse UNC prefixes.
- Repo files use LF line endings (`.gitattributes`); parsers still accept CRLF.

## Conventions

- Errors: return typed result objects (`{ ok: true, value } | { ok: false, error }`) from `core`. Throw only for programmer errors.
- No default exports.
- File names in kebab-case, types in PascalCase.
- Public functions in `core` have TSDoc comments.
- Commits use Conventional Commits for the subject line, plus spec trailers (see `README.md`).

## Testing

- `core`: unit tests plus fixture repos under `fixtures/` (real git repos built by a setup script, not committed `.git` folders).
- Adapters: contract tests against recorded event streams in `fixtures/streams/`. No live model calls in CI.
- CLI: snapshot tests on text and JSON output.
- Extension: a handful of smoke tests (activation, tree view loads, command runs against a fixture).

## Security

- Never pass spec content to a shell unescaped. Spawn processes with argument arrays, never a command string.
- The tool does not store API keys. Authentication is the harness's job.
- The extension asks before running a task, unless the user opted out in settings.
