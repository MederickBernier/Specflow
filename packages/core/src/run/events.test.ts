import { describe, expect, it } from "vitest";
import { eventSequenceProblems, parseRunEvent, type RunEvent, runEventKinds } from "./events.js";

const examples: RunEvent[] = [
  { kind: "started", runId: "run-1", harness: "claude-code", at: "2026-01-01T00:00:00Z" },
  { kind: "message", role: "assistant", text: "Working on it" },
  { kind: "tool-call", tool: "Edit", summary: "src/auth/login.ts" },
  { kind: "file-changed", path: "src/auth/login.ts", change: "modified" },
  { kind: "command", command: "pnpm test", exitCode: 0 },
  { kind: "usage", inputTokens: 1200, outputTokens: 300, costUsd: 0.02, durationMs: 4500 },
  { kind: "error", message: "rate limited", fatal: false },
  { kind: "finished", ok: true, summary: "Done" },
];

describe("RunEvent", () => {
  // task-run/R1: only these kinds exist.
  it("has exactly the kinds from the design", () => {
    expect(runEventKinds).toEqual([
      "started",
      "message",
      "tool-call",
      "file-changed",
      "command",
      "usage",
      "error",
      "finished",
    ]);
    expect(examples.map((e) => e.kind)).toEqual([...runEventKinds]);
  });

  it.each(examples)("accepts a valid $kind event", (event) => {
    expect(parseRunEvent(JSON.parse(JSON.stringify(event)))).toEqual({ ok: true, value: event });
  });

  // task-run/R1: usage is optional, and so are its fields.
  it("accepts usage with no fields, and streams without usage", () => {
    expect(parseRunEvent({ kind: "usage" }).ok).toBe(true);
    expect(eventSequenceProblems(examples.filter((e) => e.kind !== "usage"))).toEqual([]);
  });

  it.each([
    [{ kind: "thinking", text: "hmm" }, "kind"],
    [{ kind: "message", role: "user", text: "hi" }, "role"],
    [{ kind: "file-changed", path: "a.ts", change: "renamed" }, "change"],
    [{ kind: "finished" }, "ok"],
    [{ kind: "message", role: "assistant", text: "hi", raw: {} }, "raw"],
    ["not an object", ""],
  ])("rejects %j", (value, key) => {
    const result = parseRunEvent(value);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/^Invalid run event: /);
    if (key) expect(!result.ok && result.error).toContain(key);
  });
});

describe("eventSequenceProblems", () => {
  const started = examples[0]!;
  const finished = examples.at(-1)!;
  const message = examples[1]!;

  it("accepts started ... finished", () => {
    expect(eventSequenceProblems(examples)).toEqual([]);
    expect(eventSequenceProblems([started, finished])).toEqual([]);
  });

  it.each([
    [[], ["first event is not started", "last event is not finished"]],
    [[message, finished], ["first event is not started"]],
    [[started, message], ["last event is not finished"]],
    [[started, started, finished], ["2 started events, expected 1"]],
    [[started, finished, message, finished], ["2 finished events, expected 1"]],
  ])("reports problems in %j", (events, problems) => {
    expect(eventSequenceProblems(events as RunEvent[])).toEqual(problems);
  });
});
