# Product

Name: **specflow**. npm packages under the `@specflow` scope, CLI binary `specflow`.

## Vision

A spec-driven development tool for VS Code that drives the agent harness you already use, keeps a spec-to-commit trail in git, and warns you when code and spec drift apart.

## Problem

Agentic coding tools write code fast but lose the "why". After a few iterations nobody can say which requirement a change serves, or whether the spec still describes the code. Existing spec-driven tools either bring their own agent and IDE, or stop at generating markdown and leave the trail to the developer.

## Users

- **Primary:** a developer already using an agent harness (Claude Code first) who wants structure without leaving VS Code.
- **Secondary:** a lead or reviewer who needs to answer "what implements this requirement, and does it still match?" without reading every commit.
- **Later:** teams with compliance needs (for example EU CRA) who need an audit trail from requirement to code.

## Differentiators

1. **Harness agnostic.** The tool orchestrates; the harness codes. Claude Code first, others through adapters.
2. **Traceability in git.** Commit trailers link commits to tasks and requirements. No database, survives rebases, readable by any tool.
3. **Drift detection.** Code that changed without its spec changing is flagged like a compile error.

## Principles

- Specs are plain markdown that humans and agents both read. No proprietary format.
- The CLI can do everything the extension does. The extension renders and dispatches.
- Flag, never silently rewrite. Humans decide when the spec changes.
- Reuse VS Code and the harness for what they already do well (chat, editor, git graph). The workbench shows diffs in the context of a run or requirement, with VS Code's diff editor one click away.

## Non-goals for v1

- Our own agent, chat UI, or model integration.
- Forking VS Code.
- Harnesses other than Claude Code.
- Hooks, parallel agents, worktrees.
- JetBrains plugin.
- Automatic spec rewriting.

## Success criteria for v1

- The author builds one real feature on another repo entirely through the tool.
- A stranger installs from the Marketplace and runs a task using only the README.
- Drift findings on the fixture repo have zero false positives with the rule-based pass.

## Open questions

- Open source from day one, or private until the extension works? Licensed MIT (2026-10-25); visibility still open.
- Default after a task run: auto-commit, or leave changes staged for review?
