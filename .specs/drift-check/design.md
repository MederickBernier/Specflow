# drift-check: design

## Overview

Two passes over data the tool already has: the spec tree and the trailer index from `task-run`'s trace.

```
SpecTree + TraceIndex + git history
   -> rule pass (deterministic, cheap)  -> Finding[]
   -> optional LLM pass (per finding)   -> Finding[] with verdict
```

Drift findings reuse the `Finding` type from `core-spec-model`, with `rule` values prefixed `drift/`.

## Building blocks

- **TraceIndex:** for each requirement, the commits referencing it and the files they touched. Built once per run from `git log`.
- **Spec history:** for each requirement, the last commit that changed its text. Found with `git log -L <start>,<end>:<file>` on the requirement's line range, falling back to the file's last change if the range moved.
- **File history:** for each file in a requirement's touched set, commits after the requirement's last trace commit, filtered by `drift.ignore`.

## Rules

| Rule | Logic | Severity |
| --- | --- | --- |
| `drift/code-changed-since-spec` | A touched file has a later commit that does not reference the requirement, and the spec text did not change after that commit | warning |
| `drift/spec-changed-since-code` | Spec text changed after the newest trace commit | warning |
| `drift/unimplemented` | Approved, all tasks done, no trace commit | warning |

"Touched set" is the union of files from trace commits, minus files deleted later.

## Suppression

`drift-ack: <hash>` on a requirement. A finding is suppressed when every commit causing it is an ancestor of, or equal to, the acked hash (`git merge-base --is-ancestor`).

## LLM pass

- Runs through the configured harness adapter with a read-only prompt: the requirement, its acceptance criteria, and the current content of the touched files (truncated to a configured byte budget).
- The prompt asks for a single JSON object `{ "verdict": "holds" | "broken" | "unsure", "reason": "..." }`.
- A malformed answer becomes `unsure` with the raw text in the reason. Never fails the whole run.
- Tells the harness not to edit files. If any `file-changed` event arrives, the run is aborted and the finding is marked `unsure`.

## Performance

- One `git log --name-status` call for the whole history, parsed in a stream.
- `git log -L` only for requirements that have trace commits.
- No caching in v1; measure against the R8 target first.

## CLI surface

- `specflow drift [<feature>[/<id>]] [--llm] [--json]`
- Exit code 0 always, unless `--fail-on warning` is passed, for CI use.

## Alternatives considered

- **Hash the requirement text and store it in trailers:** detects spec changes without `git log -L`, but bloats commit messages. Keep as an optimization if R8 fails.
- **Embeddings to match code to requirements:** no trailers needed, but non-deterministic and opaque. Out of scope.
