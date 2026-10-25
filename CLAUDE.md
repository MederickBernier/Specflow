# Agent instructions

This repo is built spec first. Before writing code:

1. Read `.specs/README.md`, `.specs/product.md` and `.specs/tech.md`.
2. Read the feature folder for the task you were given: `requirements.md`, `design.md`, `tasks.md`.
3. Implement only the task you were given. Do not start other tasks.
4. Follow the architecture rules in `tech.md`, especially: `core` never imports `vscode` or spawns processes.
5. Add or update tests for every requirement the task references.
6. If the design cannot work as written, stop and explain why instead of improvising.
7. When done, set the task's `status: done` in `tasks.md` and end every commit message with the spec trailers:

```
Spec-Feature: <feature>
Spec-Task: <T id>
Spec-Req: <R ids>
```
