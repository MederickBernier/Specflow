# Specflow

Spec-driven development for the agent harness you already use. Write requirements and tasks as plain markdown, run each task through Claude Code, review the result, and keep a trail in git from every commit back to the requirement it implements. Specflow warns when code and spec drift apart.

Specflow brings no agent or model of its own. It orchestrates; Claude Code writes the code, with your own settings, permissions and sign-in.

> **Status:** v0.1, not yet published. Claude Code is the only harness. The extension installs from a `.vsix` and the CLI runs from source (see [Install](#install)).

## How it works

```
.specs/auth/requirements.md     ## R1: Sign in            (what and why, with Given/When/Then)
.specs/auth/tasks.md            ## T3: Login form [R1]    (one unit of work, files: it may touch)
            │
            ▼  specflow run auth/T3
   Claude Code implements T3  ──►  changes staged for review, status: done
            │
            ▼  you review and commit
   feat(auth): add the login form
   Spec-Feature: auth
   Spec-Task: T3
   Spec-Req: R1
            │
            ▼
   specflow trace auth/R1    which tasks and commits implement R1
   specflow drift            which requirements' code changed without their spec, or the reverse
```

1. **Specs are markdown** in `.specs/`: steering files (`product.md`, `tech.md`) plus one folder per feature with `requirements.md`, `design.md` and `tasks.md`. Humans and agents read the same files.
2. **A run is one task.** Specflow builds a prompt from the task, its requirements, the design and the steering files, runs Claude Code headless, streams what it does, sets the task to `doing` then `done`, and records the result: staged for your review, or committed right away.
3. **Commits carry trailers** (`Spec-Feature`, `Spec-Task`, `Spec-Req`). The trail lives in git: no database, it survives rebases, and any tool can read it.
4. **Drift is flagged like a compile error.** Rules compare each requirement's spec history with the history of the code its tasks touched. Specflow flags; humans decide when the spec changes.

## Install

Requires **Node 22.18** or later, **git**, and **Claude Code 2.1** or later, installed and signed in (`claude --version`, `claude auth status`; [install guide](https://code.claude.com/docs/en/setup)). On Windows, use Claude Code's native installer (`claude.exe`): the npm package installs `claude.cmd`, which Specflow cannot start without a shell.

```sh
git clone https://github.com/MederickBernier/Specflow.git
cd Specflow
pnpm install
pnpm build
```

- **VS Code extension:** `pnpm --filter specflow-vscode package`, then in VS Code run **Extensions: Install from VSIX...** and pick `packages/vscode/specflow-vscode.vsix`. The [extension README](packages/vscode/README.md) walks from install to a reviewed commit in five minutes.
- **CLI:** run `node packages/cli/dist/index.js`, or put it on your path as `specflow`, for example `alias specflow="node $PWD/packages/cli/dist/index.js"`.

## Quick start with the CLI

In the repository you want to build:

```sh
specflow init                       # creates .specs/ with steering files, config.yml and an example feature
# edit .specs/product.md and .specs/tech.md, then write a feature (rename .specs/example/)
specflow lint                       # checks headings, IDs, references and dependencies
specflow harness check              # is Claude Code installed and signed in?
specflow run auth/T1                # runs the task, stages the result, marks it done
git diff --cached                   # review
git commit -F .git/SPECFLOW_MSG     # the prepared message, with trailers
specflow trace auth/R1              # tasks and commits behind R1
specflow drift                      # code and spec that no longer agree
```

**Let the agent run your tests.** Claude Code runs headless, so nobody can approve shell commands during a run, and they are denied unless allowed. Allow your test command in `.specs/config.yml` (or in your Claude Code settings):

```yaml
harness:
  claude-code:
    extraArgs: ["--allowedTools", "Bash(npm test:*)"]
```

Rules match the whole command, so `npm test && npm run lint` needs its own rule.

## Writing specs

```
.specs/
  README.md        conventions for your team
  product.md       what you build, for whom, and what you don't
  tech.md          stack, architecture rules, how to run tests
  config.yml       harness, ID prefixes, commit mode, drift settings
  <feature>/
    requirements.md
    design.md
    tasks.md
```

A requirement:

```markdown
## R1: Sign in with email and password
priority: must
status: approved

Users sign in with the email and password they registered with.

- Given a registered user
- When they submit the right email and password
- Then they are signed in and see their dashboard
```

A task:

```markdown
## T3: Login form [R1]
status: todo
files: src/auth/login.ts, src/auth/login.test.ts
depends: T1

The form posts to /login and shows the error message on failure.
```

- IDs are `R<n>` and `T<n>`, numbered per feature and never reused; a removed requirement keeps its heading with `status: removed`. A full reference is `feature/R1`.
- `status:` is `draft`, `approved` or `removed` for requirements, and `todo`, `doing`, `done` or `blocked` for tasks. Specflow owns a task's status line during runs.
- `files:` lists what the task may change (globs allowed). Changes outside it are flagged after a run, since they would be attributed to the wrong requirement.
- `depends:` names tasks in the same feature (`T1`) or another (`billing/T2`).
- `drift-ack: <commit>` on a requirement acknowledges drift up to that commit (`specflow drift ack` writes it).

### config.yml

| Key | Default | Purpose |
| --- | --- | --- |
| `specsDir` | `.specs` | Where feature folders live |
| `harness.default` | `claude-code` | Harness for runs |
| `harness.claude-code.extraArgs` | `[]` | Arguments passed to `claude`, such as `--model` or `--allowedTools` |
| `ids.requirement`, `ids.task` | `R`, `T` | ID prefixes |
| `commit.mode` | `staged` | `staged`: stage the result and prepare the message for review; `auto`: commit right away |
| `commit.trailers` | `true` | Add the spec trailers to run commits |
| `drift.llm` | `false` | Also ask the harness whether each finding's code still meets its criteria |
| `drift.llmBytes` | `20000` | Most code sent to the harness per finding in the LLM pass |
| `drift.ignore` | `**/*.md`, `**/__snapshots__/**` | Files whose changes never count as drift |

## CLI reference

Every command takes `--json` and prints a versioned schema (`specflow.<command>/v1`), the contract for CI and other tools. Exit codes: `0` ok, `1` failed (lint errors, a failed run, `--fail-on` met), `2` unusable input or setup, `130` cancelled.

| Command | What it does |
| --- | --- |
| `specflow init [--force]` | Create `.specs/` with templates; `--force` adds missing files, never overwrites |
| `specflow lint` | Check the spec tree; exit 1 on errors |
| `specflow show <feature[/id]>` | Show a feature, requirement or task |
| `specflow run <feature/task> [--harness <name>] [--allow-dirty]` | Run a task and record the result; refuses a dirty tree outside `.specs/` unless `--allow-dirty`. Ctrl+C cancels |
| `specflow trace <feature[/id]>` | Tasks and commits behind a feature, requirement or task |
| `specflow drift [feature[/id]] [--llm] [--fail-on warning\|error]` | Drift findings; `--fail-on` makes CI fail |
| `specflow drift ack <feature/R<n>> <commit>` | Acknowledge drift on a requirement up to a commit |
| `specflow harness check [--harness <name>]` | Check that the harness is installed and signed in |

**Lint rules:** `malformed-heading`, `duplicate-id`, `unknown-ref`, `dependency-cycle`, `orphan-requirement`.

**Drift rules:**

- `drift/code-changed-since-spec`: code its tasks touched changed after the requirement last changed, in a commit that does not reference it.
- `drift/spec-changed-since-code`: an approved requirement changed after the last commit that implements it.
- `drift/unimplemented`: all its tasks are done, but no commit references it.

### In CI

```yaml
- run: specflow lint
- run: specflow drift --fail-on error
```

## The VS Code extension

The extension does everything the CLI does, from the command palette, plus:

- a **Specs** view, lint and drift in **Problems**, and CodeLens on requirement and task headings;
- a run view that streams the agent's work, and review of a staged run in VS Code's diff editor;
- the **workbench**: an overview of every feature, a task board, inline diff review, requirement traces with commit diffs, and a drift report.

See the [extension README](packages/vscode/README.md) for the walkthrough, commands, settings and troubleshooting.

## Platforms

Linux, macOS, Windows and WSL, including a WSL folder opened from Windows VS Code. CI runs on Linux and Windows with Node 22 and 24.

## Limitations

- Claude Code is the only harness. Others would come through adapters (`packages/adapter-claude-code` is the template).
- One run at a time; no parallel agents or worktrees.
- Drift rules work from file history, so tasks whose `files:` overlap can flag each other's changes. Keep `files:` narrow.
- Merge pull requests with **merge commits**. A squash merge keeps only the last commit's trailers, which breaks trace and drift for everything in it.

## Development

Requires Node 22.18 or later, pnpm and git.

```sh
pnpm install
pnpm build
pnpm test                                    # unit and integration tests; fixture repos are built first
pnpm --filter specflow-vscode test:smoke     # extension smoke tests in a real VS Code (Linux CI: xvfb-run -a)
pnpm bench                                   # drift performance benchmark
pnpm --filter specflow-vscode package        # builds specflow-vscode.vsix
```

| Package | Role |
| --- | --- |
| `packages/core` | Spec model, lint, runner, recorder, trace, drift, diffs. Never imports `vscode` or spawns processes; I/O goes through injected interfaces |
| `packages/adapter-claude-code` | Runs a task through Claude Code headless and maps its output to Specflow's event model |
| `packages/cli` | The `specflow` command |
| `packages/vscode` | The VS Code extension and its workbench webview |

This repository is built with Specflow itself: every change starts in [`.specs/`](.specs/README.md), and commits carry spec trailers, so `specflow trace` and `specflow drift` work on it. Releases are published from a `v*` tag by `.github/workflows/release.yml`.

## License

[MIT](LICENSE)
