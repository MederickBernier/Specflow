# Specflow

Spec-driven development in VS Code. Write requirements and tasks as plain markdown, run each task through the agent harness you already use (Claude Code), review the result in VS Code's diff editor, and keep a trail from every commit back to the requirement it implements. Specflow also warns when code and spec drift apart.

Specflow does not bring its own agent or model. It orchestrates; Claude Code writes the code, with your own settings, permissions and sign-in.

## Requirements

- **VS Code** 1.90 or later, on Linux, macOS, Windows or WSL.
- **Git**, and a folder that is a git repository.
- **Claude Code** 2.1 or later, installed and signed in. Check with `claude --version` and `claude auth status`. Install guide: <https://code.claude.com/docs/en/setup>.
  On Windows, use the native installer (`claude.exe`). The npm package installs `claude.cmd`, which Specflow cannot start without a shell.

Specflow never stores API keys; signing in is Claude Code's job.

## Five minutes from install to a reviewed commit

1. **Open your repository** in VS Code and run **Specflow: Initialize specs** from the Command Palette. It creates `.specs/` with steering files, a `config.yml` and an example feature, and opens `product.md`.

2. **Describe the product.** Fill in `.specs/product.md` (what you build, for whom) and `.specs/tech.md` (stack, rules, how to run tests). The agent reads both on every run.

3. **Let the agent run your tests.** Claude Code runs headless here, so nobody can approve commands during a run, and shell commands are denied unless allowed. Add an allow rule for your test command in `.specs/config.yml`:

   ```yaml
   harness:
     default: claude-code
     claude-code:
       extraArgs: ["--allowedTools", "Bash(npm test:*)"]
   ```

   Rules match the whole command, so `npm test && npm run lint` needs its own rule. You can also allow commands in your Claude Code settings instead.

4. **Write a feature.** Rename `.specs/example/` to your feature and edit its three files:
   - `requirements.md`: `## R1: Title` headings with `status: approved` and Given / When / Then bullets.
   - `design.md`: how it will be built.
   - `tasks.md`: `## T1: Title [R1]` headings with `files:` listing what the task may change.

   Problems such as an unknown requirement in a task appear in the **Problems** panel as you save.

5. **Run a task.** In the **Specs** view (Explorer sidebar), press ▶ on a task, or use the **▶ Run** lens above its heading. Confirm, and the run view streams what the agent does. **Cancel** stops it.

6. **Review.** When the run succeeds, the **Run review** view lists the changed files; click one to see its diff against `HEAD`. Then:
   - **Accept and commit** commits exactly those files with a prepared message and spec trailers (`Spec-Feature`, `Spec-Task`, `Spec-Req`), and marks the task `done`;
   - **Discard changes** puts the files back and restores the task's status.

   The run view also lists **spec notes**: problems the agent found in your spec, or decisions it made that the spec does not cover. Nothing is changed in `.specs/` for you; you decide.

7. **Trace and drift.** The lens above each requirement shows its tasks, last commit and drift findings; click it to see the commits that implement it. **Specflow: Check drift** flags requirements whose code changed without the spec, or whose spec changed without the code.

## Commands

| Command | What it does |
| --- | --- |
| Specflow: Initialize specs | Creates `.specs/` with templates |
| Specflow: Lint | Checks the specs and shows problems |
| Specflow: Show | Opens a feature, requirement or task |
| Specflow: Run task | Runs a task through the harness |
| Specflow: Cancel run | Stops the current run |
| Specflow: Accept and commit / Discard changes | Finishes a review |
| Specflow: Trace | Lists the tasks and commits behind a requirement or task |
| Specflow: Check drift | Finds code and spec that no longer agree |
| Specflow: Acknowledge drift | Marks a requirement's drift as reviewed up to a commit (`drift-ack:`) |
| Specflow: Check harness | Checks that Claude Code is installed and signed in |
| Specflow: Refresh specs | Reloads the specs |

Every command matches a command of the `specflow` CLI (`@specflow/cli`), which does the same from a terminal or CI.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `specflow.confirmRuns` | `true` | Ask before each run, naming the task, harness and commit mode |
| `specflow.driftOnSave` | `false` | Check drift whenever a spec file is saved; it reads git history, so it can take a few seconds in large repositories |
| `specflow.harness` | `""` | Harness to use on this machine, overriding `harness.default` |

Project settings live in `.specs/config.yml`. `commit.mode: staged` (the default) stages a run's result for review; `auto` commits it right away.

## Troubleshooting

- **"Claude Code (claude) was not found on PATH"**: install Claude Code, or on Windows switch to the native installer. Run **Specflow: Check harness** after.
- **"Uncommitted changes outside .specs/"**: a run needs a clean tree so its changes can be reviewed alone. Commit or stash, or choose **Run anyway**.
- **The agent says a command was denied**: add an allow rule as in step 3.
- **Warning about files changed outside the task's files list**: the agent touched files the task did not plan. They are recorded, but check they belong to this task, or the trace will attribute them to the wrong requirement.

## License

MIT
