# Changelog

## 0.1.0

First release.

- Specs view, lint diagnostics and CodeLens for `.specs/` requirements and tasks.
- Run a task through Claude Code, stream it into a run view, cancel it.
- Review a run in the diff editor, then accept (commit with spec trailers) or discard.
- Trace requirements to commits; rule-based drift check with optional LLM review.
- Workbench: one editor tab with an overview of every feature, a task board, inline diff review of a run (or of your uncommitted changes), requirement traces with commit diffs, and a drift report.
- Acknowledge drift from the workbench, the palette (**Specflow: Acknowledge drift**) or the CLI (`specflow drift ack`).
