# task-run: design

## Overview

```
CLI / extension
   -> Runner (core)            builds prompt, checks git, picks adapter, updates status
       -> Adapter              spawns the harness, translates its output
       <- AsyncIterable<RunEvent>
   -> Recorder (core)          stages or commits with trailers
```

The runner lives in `core` but takes the process spawner and git client as injected interfaces, so `core` still never spawns processes itself.

## Runner

`startRun(deps, tree, request, signal)` with `deps = { fs, git, registry, clock }` does every check before anything is sent to the harness, and returns `{ harness, prompt, warnings, events }` or a `RunError`:

1. Build the prompt (`unknown-task`, `unknown-requirement`).
2. Resolve the adapter from `request.harness` or `harness.default` (`unknown-adapter`).
3. Unless `allowDirty`: `git status --porcelain=v1 -z --untracked-files=all -- . :(exclude)<specsDir>` from the spec root; any entry refuses with the file list (`dirty-tree`).
4. `adapter.check()` (`harness-unavailable`); its warnings are passed through.

`events` starts the harness when first read and is supervised, so shells can rely on the event rules whatever the adapter does:

- A missing `started` is added, extra ones are dropped, anything after `finished` is ignored.
- An adapter that ends without `finished` or throws gets a fatal `error` and `finished { ok: false }`.
- After an abort, a failed `finished` is marked `cancelled`. If the adapter has not finished within 5 seconds of the abort (`cancelGraceMs`), the runner emits a non-fatal `error` and `finished { ok: false, cancelled: true }` itself and stops the adapter.
- When the caller stops reading, the adapter's iterator is returned so it can stop its process.

Adapters must treat a signal that is already aborted when they start waiting on it as aborted; listening for the `abort` event alone misses it.

## Event model

```ts
type RunEvent =
  | { kind: "started"; runId: string; harness: string; at: string }
  | { kind: "message"; role: "assistant" | "system"; text: string }
  | { kind: "tool-call"; tool: string; summary: string }
  | { kind: "file-changed"; path: string; change: "added" | "modified" | "deleted" }
  | { kind: "command"; command: string; exitCode?: number }
  | { kind: "usage"; inputTokens?: number; outputTokens?: number; costUsd?: number; durationMs?: number }
  | { kind: "error"; message: string; fatal: boolean }
  | { kind: "finished"; ok: boolean; cancelled?: boolean; summary?: string };
```

Rules: exactly one `started` first, exactly one `finished` last. Unknown harness events are dropped by the adapter, never passed through.

## Adapter interface

```ts
interface HarnessAdapter {
  readonly name: string;
  check(): Promise<Result<HarnessCheck, HarnessCheckError>>;  // installed, logged in
  run(input: RunInput, signal: AbortSignal): AsyncIterable<RunEvent>;
}

type RunInput = { cwd: string; prompt: string; extraArgs: string[] };
type HarnessCheck = { version: string; warnings: string[] };   // e.g. version outside the tested range
type HarnessCheckError = { kind: "not-installed" | "not-authenticated" | "failed"; message: string; installUrl?: string };
```

`AdapterRegistry` holds adapters by name; `resolve(config, override?)` picks `override` (from `--harness` or the editor setting) or `harness.default`, and an unknown name returns `{ kind: "unknown-adapter", known: [...] }`. Registering a name twice throws.

`parseRunEvent` validates events read from files or processes against a strict schema, and `eventSequenceProblems` checks the started-first, finished-last rule; adapter contract tests use both.

## I/O interfaces

Defined in `core`, implemented for Node in `core/node`, faked in tests.

```ts
type GitError = { args: string[]; exitCode: number | null; stderr: string; message: string };

interface Git {
  // Runs `git <args>` in cwd with an argument array, never a shell string. Stdout is returned exactly.
  run(args: string[], opts?: { cwd?: string; stdin?: string }): Promise<Result<string, GitError>>;
  // Same, but yields stdout line by line, for large `git log` output.
  // Throws GitCommandError (carrying the GitError) at the end if git fails; stopping early kills git.
  lines(args: string[], opts?: { cwd?: string }): AsyncIterable<string>;
}

interface Spawner {
  spawn(command: string, args: string[], opts: { cwd: string; stdin?: string }): SpawnedProcess;
}

interface SpawnedProcess {
  stdout: AsyncIterable<string>;   // line by line, buffered from the start
  stderr: AsyncIterable<string>;
  // Never rejects. `error` is set when the process could not start (e.g. ENOENT).
  exit: Promise<{ code: number | null; signal: string | null; error?: { code?: string; message: string } }>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

interface Clock {
  now(): Date;
}
```

Both streams are buffered without limit as soon as the process starts, so a caller reading only stdout cannot stall a process that writes a lot to stderr. Test fakes (`FakeGit`, `FakeSpawner`/`FakeProcess`, `FakeClock`) live next to the interfaces in `core`; Node implementations (`NodeGit`, `NodeSpawner`, `SystemClock`) in `core/node`. `NodeGit` sets `GIT_TERMINAL_PROMPT=0` and `LC_ALL=C`.

`Git` stays deliberately thin: typed helpers (`status`, `stage`, `commit`, `log`, `isAncestor`) are plain functions in `core` built on `run` and `lines`, so their parsing is unit tested without a real repo.

## Replay adapter

- `ReplayAdapter` takes events directly or a `.jsonl` file (one `RunEvent` per line) read through the injected `FileSystem` when the run starts. `parseEventStream` validates each line and names the line on error.
- Events are replayed as recorded, even a malformed sequence, so runner robustness can be tested. Aborting stops the replay with `finished { ok: false, cancelled: true }`, synthesizing `started` first if none was emitted.
- An unreadable or invalid file becomes `started`, a fatal `error` and `finished { ok: false }`; `check()` reports it as `failed`.
- Optional `delayMs` between events, through an injectable `sleep`. Each `RunInput` is kept in `inputs` for assertions.
- Shared normalized streams for runner and UI tests live in `fixtures/events/` (`success.jsonl`, `failure.jsonl`), apart from raw harness recordings in `fixtures/streams/`.

## Claude Code adapter

- Spawn `claude -p --output-format stream-json --verbose --permission-mode acceptEdits`, then `extraArgs`, passing the prompt on stdin and arguments as an array (no shell). Do not pass flags that skip the user's own settings, permissions or MCP servers.
- Read stdout line by line, parse each line as JSON, map to `RunEvent`. The mapping table is in `docs/spikes/claude-code-headless.md`.
- `file-changed` events come from the `user` tool-result lines of Write and Edit. The model also changes files through Bash, so after exit a `git status` pass is required to report the rest.
- `usage` comes from the final `result` line. Tool denials (`system/permission_denied`) become non-fatal `error` events: a run can end `success` with a denied tool.
- Cancellation: on abort, send SIGTERM, then SIGKILL after 5 seconds. Claude Code prints no `result` when killed, so the adapter emits the cancelled `finished` itself.
- Pin a tested version range of Claude Code (`>=2.1.0 <3`). `check()` warns, but does not fail, outside the range, and reads `loggedIn` from `claude auth status --json`.
- `ClaudeCodeAdapter({ spawner, git, clock })` takes the core interfaces, so contract tests play the recorded streams through `FakeSpawner`. `StreamMapper` holds the line-to-event mapping.
- The `git status` pass compares against a snapshot taken before the run, so files that were already dirty (with `--allow-dirty`) are not reported, and skips silently outside a git repository.
- `check()` sends users to `https://code.claude.com/docs/en/setup`. On Windows, a missing `claude` explains that the npm-installed `claude.cmd` cannot be started without a shell and points to the native installer; no shell is ever used.
- Flags and event fields were verified in the spike (task T1, `docs/spikes/claude-code-headless.md`) against 2.1.310 and recorded in `fixtures/streams/`.

## Prompt template

```
<steering>
{product.md}
{tech.md}
</steering>

<task id="{feature}/{task.id}">
{task heading and body}
</task>

<requirements>
<requirement id="{feature}/{id}">
{each referenced requirement, full text}
</requirement>
</requirements>

<design>
{feature design.md}
</design>

Work on this task only. Do not edit files under {specsDir}/ except to set this task's status.
If the design cannot work as written, stop and explain why.
```

Template lives in `core/src/run/prompt.ts` (`buildTaskPrompt(fs, tree, { feature, task })`) and is snapshot tested.

- Task and requirement text is copied from the source files by line range, metadata included.
- A requirement referenced in another feature (`other/R1`) is included; that feature's design and other requirements are not.
- Missing steering or design files and empty sections are left out.
- An unknown task or referenced requirement returns an error instead of a partial prompt.

## Recording

- Trailers are appended with `git interpret-trailers` semantics: a blank line, then `Key: value` lines.
- Commit subject comes from the task title: `feat({feature}): {task title}`.
- In `staged` mode the prepared message is written to `.git/SPECFLOW_MSG` and returned, so the user can commit with `git commit -F`.

## Status updates

A targeted line edit on the task's `status:` line using the location from the spec model. If the line is missing, it is inserted right after the heading.

## Trace

`git log --format=<custom> --name-status` filtered by `--grep` on trailer keys, then parsed with `git interpret-trailers --parse`. Results are grouped per requirement and per task.

## CLI surface

- `specflow run <feature>/<task> [--harness name] [--allow-dirty] [--json]`, streams events, Ctrl+C cancels
- `specflow trace <feature>[/<id>] [--json]`
- `specflow harness check`

## Alternatives considered

- **Claude Agent SDK instead of the CLI:** tighter control, but ties the adapter to one SDK version and duplicates the user's existing Claude Code setup (permissions, MCP servers, settings). Keep as an option for a second adapter.
- **Storing trace links in a JSON file:** breaks on rebase and conflicts in teams. Rejected.
