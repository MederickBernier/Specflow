# drift-check: requirements

Detect when code and spec no longer agree, and report it as findings people can act on. Flag only, never rewrite.

## R1: Rule-based drift detection
priority: must
status: approved

Find requirements whose implementing code changed after the requirement last changed.

- Given commits with trailers referencing `R3` that touched `src/auth/login.ts`
- And a later commit changed `src/auth/login.ts` without referencing `R3`
- And `R3`'s text has not changed since
- When drift check runs
- Then a `code-changed-since-spec` finding is reported on `R3`, naming the file and the commit

## R2: Spec changed, code did not
priority: should
status: approved

- Given `R3`'s text changed in a commit
- And no commit referencing `R3` came after that change
- When drift check runs
- Then a `spec-changed-since-code` finding is reported on `R3`

## R3: Unimplemented requirements
priority: must
status: approved

- Given an approved requirement with no commit referencing it
- And all its tasks are `done`
- Then an `unimplemented` warning is reported, because done tasks with no trace means trailers were missed

## R4: Ignore rules
priority: must
status: approved

- Given a changed file matching a `drift.ignore` glob in config
- Then it never produces a finding

## R5: Suppress a finding
priority: should
status: approved

A human can acknowledge a finding so it stops being reported until something changes again.

- Given a requirement with the metadata line `drift-ack: <commit hash>`
- Then findings caused by commits up to and including that hash are not reported
- And a newer change reports again

## R6: Optional LLM pass
priority: could
status: approved

- Given `drift.llm: true`
- When drift check runs
- Then for each rule-based finding, the harness is asked whether the current code still satisfies the requirement's acceptance criteria
- And the answer is attached to the finding as `verdict: holds | broken | unsure` with a short reason
- And no LLM call is made when `drift.llm` is false

## R7: Stable output
priority: must
status: approved

- Given the same repo state
- When drift check runs twice
- Then the rule-based findings are identical, in the same order, in text and JSON

## R8: Performance
priority: should
status: approved

- Given a repo with 5,000 commits and 200 requirements
- When the rule-based pass runs
- Then it finishes in under 5 seconds on a typical laptop
