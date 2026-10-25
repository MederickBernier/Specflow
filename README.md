# Specflow

Spec-driven development that drives the agent harness you already use (Claude Code first), keeps a spec-to-commit trail in git, and warns when code and spec drift apart.

- **VS Code extension** (`packages/vscode`): browse specs, run tasks, review diffs, see lint and drift in Problems. See its [README](packages/vscode/README.md) to get started.
- **CLI** (`packages/cli`, binary `specflow`): `init`, `lint`, `show`, `run`, `trace`, `drift`, `drift ack`, `harness check`, each with `--json` for CI and other tools.
- **Core** (`packages/core`): the spec model, lint, runner, recorder, trace and drift rules, shared by both.

This repository is built with Specflow itself: see [`.specs/`](.specs/README.md).

## Development

Requires Node 22.18 or later, pnpm and git.

```sh
pnpm install
pnpm build
pnpm test                                    # unit and integration tests, fixture repos built first
pnpm --filter specflow-vscode test:smoke     # extension smoke tests in a real VS Code (Linux CI: xvfb-run -a)
pnpm bench                                   # drift performance benchmark
pnpm --filter specflow-vscode package        # builds specflow-vscode.vsix
```

Releases are published from a `v*` tag by `.github/workflows/release.yml`.

## License

[MIT](LICENSE)
