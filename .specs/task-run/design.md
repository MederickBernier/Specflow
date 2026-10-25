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

## Claude Code adapter

- Spawn the `claude` binary in print mode with streaming JSON output, passing the prompt on stdin and arguments as an array (no shell).
- Read stdout line by line, parse each line as JSON, map to `RunEvent`.
- `file-changed` events come from the harness's edit and write tool calls; after exit, a `git status` diff fills any gaps.
- `usage` comes from the final result event.
- Cancellation: on abort, send SIGTERM, then SIGKILL after 5 seconds.
- Pin a tested version range of Claude Code. `check()` warns, but does not fail, outside the range.
- Exact flags and event field names are verified in a spike (task T1) and recorded in `fixtures/streams/`.

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
{each referenced requirement, full text}
</requirements>

<design>
{feature design.md}
</design>

Work on this task only. Do not edit files under .specs/ except to set this task's status.
If the design cannot work as written, stop and explain why.
```

Template lives in `core/src/run/prompt.ts` and is snapshot tested.

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
