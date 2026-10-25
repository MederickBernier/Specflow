# drift-check: tasks

## T1: Drift fixture repos []
status: done
files: fixtures/drift/**, fixtures/git.ts
depends: core-spec-model/T2, task-run/T7

One fixture per rule, plus a clean one, plus an acked one, plus one where an out-of-scope file must not widen the touched set. Each fixture's expected findings are written next to it as JSON.

## T2: TraceIndex and file history [R1, R4]
status: done
files: packages/core/src/drift/index.ts, packages/core/src/trace/commits.ts
depends: task-run/T9

Built from a single `git log` stream, respects `drift.ignore`.

## T3: Spec history per requirement [R2]
status: done
files: packages/core/src/drift/spec-history.ts
depends: T2

Returns the last commit that changed a requirement's text, correct even after the requirement moved within the file.

## T4: Rule code-changed-since-spec [R1, R7]
status: done
files: packages/core/src/drift/rules/code-changed.ts, packages/core/src/drift/context.ts, packages/core/src/model.ts
depends: T2, T3, T1

Matches its fixture exactly, no findings on the clean fixture.

## T5: Rules spec-changed-since-code and unimplemented [R2, R3, R7]
status: done
files: packages/core/src/drift/rules/spec-changed.ts, packages/core/src/drift/rules/unimplemented.ts
depends: T3, T1

Match their fixtures exactly.

## T6: Suppression with drift-ack [R5]
status: done
files: packages/core/src/drift/suppress.ts, packages/core/src/drift/check.ts
depends: T4, T5

Acked fixture reports nothing; adding a newer commit makes the finding return.

## T7: CLI drift command [R7]
status: done
files: packages/cli/src/commands/drift.ts
depends: T6

Snapshot tests on text and JSON; two runs produce identical output; `--fail-on` sets the exit code.

## T8: Performance benchmark [R8]
status: todo
files: bench/drift.bench.ts
depends: T7

Generated repo with 5,000 commits and 200 requirements runs under 5 seconds; result recorded in the PR.

## T9: Optional LLM pass [R6]
status: todo
files: packages/core/src/drift/llm.ts
depends: T7, task-run/T6

With the replay adapter: valid, malformed and file-editing answers map to holds/broken, unsure, and unsure with abort.
