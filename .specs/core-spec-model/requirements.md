# core-spec-model: requirements

The foundation: read `.specs/` into a typed model, validate it, and scaffold new projects. Everything else consumes this model.

## R1: Parse requirements files
priority: must
status: approved

Turn each `requirements.md` into a list of requirements with ID, title, priority, status, body and acceptance criteria.

- Given a `requirements.md` with headings `## R<n>: <title>`
- When the spec loader runs
- Then each heading becomes a requirement with its metadata lines and body, and its Given/When/Then bullets are captured as acceptance criteria

## R2: Parse tasks files
priority: must
status: approved

Turn each `tasks.md` into a list of tasks with ID, title, requirement references, status, files, dependencies and body.

- Given a heading `## T2: Add lockout counter [R3, R4]`
- When the spec loader runs
- Then the task has ID `T2`, title `Add lockout counter`, references `R3` and `R4`, and the metadata lines `status`, `files`, `depends`

## R3: Load a whole spec tree
priority: must
status: approved

Load every feature folder under the configured specs directory into one model, including `design.md` as raw markdown.

- Given a repo with `.specs/` containing several feature folders
- When the loader runs from any subdirectory of the repo
- Then it finds the repo root, reads `config.yml`, and returns all features in folder-name order

## R4: Source locations
priority: must
status: approved

Every requirement, task and lint finding carries its file path and line range, so editors can jump to it.

- Given any parsed requirement or task
- Then it exposes `file`, `startLine` and `endLine`, 1-based

## R5: Lint the spec tree
priority: must
status: approved

Report structural problems as findings with a rule ID, severity, message and location.

- Given duplicate IDs in one feature, then rule `duplicate-id` reports an error
- Given a task referencing an unknown requirement, then rule `unknown-ref` reports an error
- Given an approved requirement with no task, then rule `orphan-requirement` reports a warning
- Given a heading that looks like an ID but does not parse, then rule `malformed-heading` reports an error
- Given a task `depends` cycle, then rule `dependency-cycle` reports an error

## R6: Config file
priority: must
status: approved

Read and validate `.specs/config.yml`, falling back to defaults when it is missing.

- Given no `config.yml`, then defaults from `tech.md` apply and no error is raised
- Given an invalid value, then loading fails with a message naming the key and the expected type

## R7: Scaffold with init
priority: should
status: approved

Create a `.specs/` folder with steering file templates, a default `config.yml`, and one example feature.

- Given a repo with no `.specs/`
- When `init` runs
- Then the folder and templates are created and lint passes on the result
- Given a repo that already has `.specs/`, then `init` refuses unless `--force` is passed, and never overwrites existing files

## R8: Tolerant parsing
priority: should
status: approved

Unknown metadata keys and free-form content never break parsing.

- Given a requirement with an extra line `owner: someone`
- Then it is kept in an `extra` map and no error is raised
