# task-run: tasks

## T1: Spike Claude Code headless output [R4]
status: done
files: fixtures/streams/*.jsonl, fixtures/streams/sanitize.ts, docs/spikes/claude-code-headless.md
depends: core-spec-model/T1

Run Claude Code headless on two toy tasks (one success, one failure), save the raw streams as fixtures and note the flags and event fields used.

## T2: Define the event model and adapter interface [R1, R2]
status: done
files: packages/core/src/run/events.ts, packages/core/src/run/adapter.ts
depends: core-spec-model/T3

Types compile, a registry resolves adapters by name, an unknown name returns the list of known adapters.

## T3: Replay adapter [R9]
status: done
files: packages/core/src/run/replay-adapter.ts, fixtures/events/*.jsonl
depends: T2

Replays a `.jsonl` stream of `RunEvent`s with optional delay; used by all runner and UI tests.

## T4: Prompt builder [R3]
status: done
files: packages/core/src/run/prompt.ts
depends: T2, core-spec-model/T7

Snapshot test on the clean fixture; other features' specs never appear in the prompt.

## T5: Runner with dirty tree check and cancellation [R5, R10]
status: done
files: packages/core/src/run/runner.ts, packages/core/src/git-status.ts
depends: T3, T4, T12

With the replay adapter: dirty tree refuses, `--allow-dirty` proceeds, abort yields a cancelled `finished` event.

## T6: Claude Code adapter [R4, R5]
status: done
files: packages/adapter-claude-code/src/**
depends: T1, T2, T12

Contract tests on the spike fixtures map every recorded stream to the expected `RunEvent` sequence; `check()` reports a missing binary clearly.

## T7: Recorder with trailers [R6]
status: done
files: packages/core/src/run/recorder.ts
depends: T5

On a fixture repo: staged mode stages files and writes the prepared message; auto mode commits with all three trailers; failed runs change nothing.

## T8: Task status updates [R7]
status: todo
files: packages/core/src/run/status.ts
depends: T5

Before and after file diff shows only the status line changed, for every transition; in staged mode the `done` edit is staged with the other changes.

## T9: Trace from git history [R8]
status: todo
files: packages/core/src/trace/**
depends: T7

Fixture repo with commits, a rebase, and commits without trailers; trace returns the expected list newest first.

## T10: CLI run, trace and harness check [R4, R8]
status: todo
files: packages/cli/src/commands/run.ts, packages/cli/src/commands/trace.ts, packages/cli/src/commands/harness.ts
depends: T6, T7, T8, T9

Commands work end to end against the replay adapter in tests, and against real Claude Code manually.

## T11: Dogfood on a real feature []
status: todo
depends: T10

Build one real feature in another repo using only `specflow run`. Write down what hurt before starting the drift-check feature.

## T12: Git, Spawner and Clock interfaces []
status: done
files: packages/core/src/git.ts, packages/core/src/spawner.ts, packages/core/src/clock.ts, packages/core/src/queue.ts, packages/core/src/node/**
depends: core-spec-model/T3

Interfaces from the design compile; Node implementations in `core/node` pass an integration test against a temp git repo; in-memory fakes exist for tests. No other `core` module imports `core/node`.
