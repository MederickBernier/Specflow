# drift-check: design

## Overview

Two passes over data the tool already has: the spec tree and the trailer index from `task-run`'s trace.

```
SpecTree + TraceIndex + git history
   -> rule pass (deterministic, cheap)  -> Finding[]
   -> optional LLM pass (per finding)   -> Finding[] with verdict
```

Drift findings reuse the `Finding` type from `core-spec-model`, with `rule` values prefixed `drift/`. They point at the requirement's heading and carry `evidence: { file, commit, subject }` naming what caused them. Only approved requirements are checked. Each rule is `{ id, check(context) }` over a `DriftContext` (`tree`, the index, and spec changes for traced requirements) built once by `buildDriftContext`. `code-changed-since-spec` reports one finding per file, naming the newest offending commit.

## Building blocks

- **TraceIndex:** for each requirement, the commits referencing it and the files they touched. Built once per run from `git log`: `readHistory` reads every commit with `--name-status` and trailers in one call (the trace format without `--grep`), and `buildDriftIndex` derives trace commits, touched sets and per-file history from it.
- **Spec history:** for each requirement, the last commit that changed its text. Found with `git log -L <start>,<end>:<file>` on the requirement's line range, falling back to the file's last change if the range moved. A commit whose only changed lines in the range are `drift-ack:` lines does not count, so acknowledging a finding does not itself raise `spec-changed-since-code`. The range comes from parsing the file at `HEAD`, since `-L` line numbers refer to HEAD; uncommitted requirements have no spec history.
- **File history:** for each file in a requirement's touched set, commits after the requirement's last trace commit, filtered by `drift.ignore`.

## Rules

| Rule | Logic | Severity |
| --- | --- | --- |
| `drift/code-changed-since-spec` | A touched file has a later commit that does not reference the requirement, and the spec text did not change after that commit | warning |
| `drift/spec-changed-since-code` | Spec text changed after the newest trace commit | warning |
| `drift/unimplemented` | Approved, all tasks done, no trace commit | warning |

"Touched set" is the union of files from trace commits, minus files deleted later.

## Attribution

Trailers record intent, not what the code does. Dogfooding (`docs/dogfood/2026-10-25-tally.md`) showed an agent writing one task's code inside another task's commit, so trailers can attribute code to the wrong requirement. `task-run/R11` warns about it at run time; drift detection limits the damage:

- A trace commit adds a file to a requirement's touched set only if the file matches the `files:` patterns of one of the requirement's tasks. Tasks without `files:` do not restrict. So a file a run changed out of scope cannot widen another requirement's touched set and cause a false positive.
- Missed attribution leaves files out of a touched set, which can only hide findings, never invent them. The rule pass errs toward false negatives, matching the v1 goal of zero false positives.
- Files under the specs folder are never in a touched set.

## Suppression

`drift-ack: <hash>` on a requirement. A finding is suppressed when every commit causing it is an ancestor of, or equal to, the acked hash (`git merge-base --is-ancestor`). The causing commit is the finding's `evidence.commit`; short hashes work. `unimplemented` has no causing commit and is suppressed by any `drift-ack` that names a real commit. An unknown hash suppresses nothing.

`checkDrift(git, tree, { target })` builds the context, runs the rules in table order, applies suppression and filters to `feature` or `feature/R<n>`.

## LLM pass

- Runs through the configured harness adapter with a read-only prompt: the requirement, its acceptance criteria, and the current content of the touched files (truncated to a configured byte budget).
- The prompt asks for a single JSON object `{ "verdict": "holds" | "broken" | "unsure", "reason": "..." }`.
- A malformed answer becomes `unsure` with the raw text in the reason. Never fails the whole run.
- Tells the harness not to edit files. If any `file-changed` event arrives, the run is aborted and the finding is marked `unsure`.

## Performance

- One `git log --name-status` call for the whole history, parsed in a stream.
- `git log -L` only for requirements that have trace commits, at most 8 at a time; `git show HEAD:<file>` once per requirements file.
- No caching in v1; measure against the R8 target first.

Measured with `pnpm bench` (`bench/drift.bench.ts`: 5,000 commits, 10 features × 20 requirements, generated with `git fast-import` from a seeded PRNG), 2026-10-25:

| Setup | Time |
| --- | --- |
| Sequential `-L` lookups, Linux (WSL), 12 cores | 9.2 s (fails R8) |
| 8 concurrent lookups, Linux (WSL), 12 cores | 2.0 s |
| 8 concurrent lookups, native Windows, same machine | 3.7 s |

Almost all of the time is the per-requirement `git log -L` (about 36 ms each); the full history log takes 160 ms. If R8 fails on slower machines, the next step is one `git log -p` per requirements file with our own range tracking, replacing 200 processes with 10.

## CLI surface

- `specflow drift [<feature>[/<id>]] [--llm] [--json]`
- Exit code 0 always, unless `--fail-on warning|error` is passed and a finding is at least that severe, for CI use. 2 when git fails or specs cannot be loaded.
- Text output matches `lint` (`file:line: severity rule: message`); `--json` prints `specflow.drift/v1` with `summary` and `findings`, including `evidence`.

## Alternatives considered

- **Hash the requirement text and store it in trailers:** detects spec changes without `git log -L`, but bloats commit messages. Keep as an optimization if R8 fails.
- **Embeddings to match code to requirements:** no trailers needed, but non-deterministic and opaque. Out of scope.
