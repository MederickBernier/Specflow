# Specs

This project is built spec first, using its own format. Every change starts here.

## Layout

```
.specs/
  README.md      # this file: conventions
  product.md     # steering: what we build, for whom, and what we don't
  tech.md        # steering: stack, architecture rules, coding conventions
  config.yml     # tool config (harness, ID prefixes, drift settings)
  <feature>/
    requirements.md   # R1, R2, ... with acceptance criteria
    design.md         # how it will be built
    tasks.md          # T1, T2, ... each referencing requirements
```

Steering files apply to every feature. Feature folders are scoped to one capability.

## Features (v1)

| Folder | Plan phase | Depends on |
| --- | --- | --- |
| `core-spec-model` | 0, 1 | none |
| `task-run` | 2 | core-spec-model |
| `drift-check` | 3 | core-spec-model, task-run |
| `vscode-extension` | 4, 5 | all of the above |

## ID rules

- Requirements are `R<n>`, tasks are `T<n>`, numbered per feature.
- A full reference is `<feature>/<id>`, for example `task-run/R2`.
- IDs are never reused. A removed requirement keeps its heading with `status: removed`.
- A task lists the requirements it satisfies in brackets: `## T3: Parse task headings [R2, R4]`.
- Setup and enabling work (CI, fixtures, spikes) uses an empty list: `## T1: Set up CI []`.
- `depends` lists task IDs in the same feature (`T2`) or in another one (`task-run/T7`).

## Requirement format

```markdown
## R3: Short imperative title
priority: must | should | could
status: draft | approved | removed

Free-text intent, one or two sentences.

- Given <context>
- When <action>
- Then <observable outcome>
```

## Task format

```markdown
## T2: Short imperative title [R1, R3]
status: todo | doing | done | blocked
files: src/path/one.ts, src/path/two.ts
depends: T1

What "done" means for this task, in one or two sentences.
```

## Commit trailers

Every commit that implements a task carries:

```
Spec-Feature: task-run
Spec-Task: T2
Spec-Req: R1, R3
```

Commits with no spec impact (formatting, dependency bumps) use `Spec-Task: none`.

## Workflow

1. Write or update `requirements.md`, set `status: approved` when it is ready.
2. Write `design.md`.
3. Break it into `tasks.md`.
4. Implement one task at a time, commit with trailers, mark it `done`.
5. If the code needs to diverge from the spec, change the spec in the same commit.
