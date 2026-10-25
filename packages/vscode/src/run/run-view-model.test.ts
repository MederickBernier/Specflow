import type { RunEvent, RunTaskResult } from "@specflow/core";
import { describe, expect, it } from "vitest";
import { cancelling, confirmationDetail, initialState, reduce, renderBody, withOutcome } from "./run-view-model.js";

const events: RunEvent[] = [
  { kind: "started", runId: "r", harness: "claude-code", at: "2026-01-01T00:00:00Z" },
  { kind: "message", role: "assistant", text: "Adding <the> counter." },
  { kind: "tool-call", tool: "Write", summary: "src/lockout.ts" },
  { kind: "file-changed", path: "src/lockout.ts", change: "added" },
  { kind: "command", command: "pnpm test", exitCode: 0 },
  { kind: "error", message: "Permission denied for Bash", fatal: false },
  { kind: "usage", inputTokens: 12400, outputTokens: 1830, costUsd: 0.0712, durationMs: 48250 },
  { kind: "finished", ok: true },
];
const replay = (list: RunEvent[]) => list.reduce(reduce, initialState("accounts/T3"));

describe("run view model", () => {
  // vscode-extension/R4: events render in order; usage goes to the footer.
  it("renders events in order with usage in the footer", () => {
    const state = replay(events);
    expect(state.status).toBe("done");
    expect(state.lines).toEqual([
      { kind: "message", text: "Adding <the> counter." },
      { kind: "tool", text: "Write src/lockout.ts" },
      { kind: "file", text: "+ src/lockout.ts" },
      { kind: "command", text: "$ pnpm test (exit 0)" },
      { kind: "warning", text: "Permission denied for Bash" },
    ]);
    const html = renderBody(state);
    expect(html).toContain("<footer>Usage: 12,400 tokens in, 1,830 out, $0.07, 48.3 s</footer>");
    expect(html.indexOf("Adding")).toBeLessThan(html.indexOf("Write src"));
    expect(html).not.toContain('data-action="cancel"');
  });

  it("escapes event text", () => {
    expect(renderBody(replay(events))).toContain("Adding &lt;the&gt; counter.");
  });

  // vscode-extension/R4: the run can be cancelled from the view.
  it("offers Cancel while running, and shows cancelling, then cancelled", () => {
    const running = replay(events.slice(0, 2));
    expect(renderBody(running)).toContain('<button data-action="cancel">Cancel</button>');
    expect(running.status).toBe("running");
    const asked = cancelling(running);
    expect(asked.status).toBe("cancelling");
    expect(renderBody(asked)).not.toContain('data-action="cancel"');
    expect(reduce(asked, { kind: "finished", ok: false, cancelled: true }).status).toBe("cancelled");
  });

  it("summarizes the outcome", () => {
    const result = {
      ok: true,
      cancelled: false,
      recording: { mode: "staged", message: "m", messageFile: "/r/.git/SPECFLOW_MSG", files: ["a", "b"] },
      scope: { outOfScope: ["src/other.ts"], specEdits: [] },
      specNotes: ["R2 is vague."],
    } as unknown as RunTaskResult;
    expect(withOutcome(replay(events), result).outcome).toBe(
      "Staged 2 files with a prepared commit message, and marked the task done.\nChanged outside the task's files: src/other.ts.\nSpec notes from the agent (not applied): R2 is vague.",
    );
  });

  // vscode-extension/R4: the confirmation names task, harness and commit mode.
  it("names the task, harness and commit mode in the confirmation", () => {
    expect(confirmationDetail("accounts/T3", "claude-code", "staged")).toBe(
      "Run accounts/T3 with claude-code? On success specflow will stage the changes for your review, with spec trailers.",
    );
    expect(confirmationDetail("a/T1", "claude-code", "auto")).toContain("commit the changes automatically");
  });
});
