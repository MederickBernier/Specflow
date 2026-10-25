import { describe, expect, it } from "vitest";
import { parsePageMessage, workbenchCommands, type WorkbenchState } from "./protocol.js";

const state: WorkbenchState = {
  revision: 3,
  harness: { state: "unknown" },
  roots: [
    {
      root: "/repo",
      name: "repo",
      lintProblems: 0,
      features: [
        {
          name: "auth",
          requirements: [{ id: "R1", title: "Sign in", status: "approved", line: 3 }],
          tasks: [{ id: "T1", title: "Login form", status: "todo", reqs: ["R1"], depends: [], waitingOn: [], line: 3 }],
        },
      ],
      drift: {
        checked: true,
        findings: [{ rule: "drift/code-changed-since-spec", severity: "warning", message: "m", feature: "auth", id: "R1", line: 3, file: "src/a.ts", commit: "abc1234" }],
      },
    },
  ],
  review: { root: "/repo", target: "auth/T1", files: [{ path: "src/a.ts", change: "modified", outOfScope: false }], specNotes: [] },
};

describe("parsePageMessage (workbench-ui/R1)", () => {
  it("accepts the page's own messages", () => {
    expect(parsePageMessage({ type: "ready" }, undefined)).toEqual({ type: "ready" });
    expect(parsePageMessage({ type: "tab", tab: "board" }, undefined)).toEqual({ type: "tab", tab: "board" });
    expect(parsePageMessage({ type: "rendered", revision: 3 }, state)).toEqual({ type: "rendered", revision: 3 });
  });

  it("accepts only the commands the page may run", () => {
    expect(parsePageMessage({ type: "command", command: "checkDrift" }, state)).toEqual({ type: "command", command: "checkDrift" });
    expect(parsePageMessage({ type: "command", command: "checkHarness", args: ["--evil"] }, state)).toEqual({ type: "command", command: "checkHarness" });
    expect(parsePageMessage({ type: "command", command: "specflow.acceptRun" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "command", command: "workbench.action.terminal.new" }, state)).toBeUndefined();
    expect(workbenchCommands).toEqual({
      checkDrift: "specflow.checkDrift",
      checkHarness: "specflow.checkHarness",
      showProblems: "workbench.actions.view.problems",
      acceptRun: "specflow.acceptRun",
      discardRun: "specflow.discardRun",
      refresh: "specflow.refresh",
    });
  });

  it("accepts Accept and Discard only while a run is under review", () => {
    expect(parsePageMessage({ type: "command", command: "acceptRun" }, state)).toBeDefined();
    expect(parsePageMessage({ type: "command", command: "discardRun" }, state)).toBeDefined();
    const idle = { ...state, review: undefined } as WorkbenchState;
    expect(parsePageMessage({ type: "command", command: "acceptRun" }, idle)).toBeUndefined();
    expect(parsePageMessage({ type: "command", command: "discardRun" }, idle)).toBeUndefined();
  });

  it("needs the revision a diff was asked for", () => {
    expect(parsePageMessage({ type: "diff", source: "working", root: "/repo" }, state)).toBeUndefined();
  });

  it("drops malformed messages", () => {
    for (const raw of [
      undefined,
      null,
      "ready",
      42,
      {},
      { type: "eval", code: "1" },
      { type: "tab", tab: "settings" },
      { type: "rendered", revision: -1 },
      { type: "rendered", revision: "3" },
      { type: "run", root: "/repo", feature: "auth" },
      { type: "run", root: "/repo", feature: "auth", task: 1 },
      { type: "openDiff", path: "" },
      { type: "diff", source: "everything", root: "/repo" },
    ]) {
      expect(parsePageMessage(raw, state), JSON.stringify(raw)).toBeUndefined();
    }
  });

  it("accepts runs and opens of items the state shows, and nothing else", () => {
    expect(parsePageMessage({ type: "run", root: "/repo", feature: "auth", task: "T1" }, state)).toBeDefined();
    expect(parsePageMessage({ type: "run", root: "/repo", feature: "auth", task: "T9" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "run", root: "/repo", feature: "auth", task: "R1" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "run", root: "/other", feature: "auth", task: "T1" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "run", root: "/repo", feature: "billing", task: "T1" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "run", root: "/repo", feature: "auth", task: "T1" }, undefined)).toBeUndefined();
    expect(parsePageMessage({ type: "open", root: "/repo", feature: "auth", id: "R1" }, state)).toBeDefined();
    expect(parsePageMessage({ type: "open", root: "/repo", feature: "auth", id: "T1" }, state)).toBeDefined();
    expect(parsePageMessage({ type: "open", root: "/repo", feature: "auth", id: "R2" }, state)).toBeUndefined();
  });

  it("accepts diffs of files under review only", () => {
    expect(parsePageMessage({ type: "openDiff", path: "src/a.ts" }, state)).toBeDefined();
    expect(parsePageMessage({ type: "openDiff", path: "../../etc/passwd" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "openDiff", path: "src/a.ts" }, { ...state, review: undefined } as WorkbenchState)).toBeUndefined();
    expect(parsePageMessage({ type: "diff", source: "review", root: "/repo", revision: 3 }, state)).toBeDefined();
    expect(parsePageMessage({ type: "diff", source: "review", root: "/repo", path: "src/a.ts", revision: 3 }, state)).toBeDefined();
    expect(parsePageMessage({ type: "diff", source: "review", root: "/repo", path: "src/other.ts", revision: 3 }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "diff", source: "review", root: "/repo", commit: "abc1234", revision: 3 }, state)).toBeUndefined();
  });

  it("accepts the whole working tree, but no single path the state does not show", () => {
    expect(parsePageMessage({ type: "diff", source: "working", root: "/repo", revision: 3 }, state)).toBeDefined();
    expect(parsePageMessage({ type: "diff", source: "working", root: "/repo", path: "src/a.ts", revision: 3 }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "diff", source: "working", root: "/elsewhere", revision: 3 }, state)).toBeUndefined();
  });

  it("accepts traces of requirements and tasks the state shows", () => {
    expect(parsePageMessage({ type: "trace", root: "/repo", ref: "auth/R1" }, state)).toEqual({ type: "trace", root: "/repo", ref: "auth/R1" });
    expect(parsePageMessage({ type: "trace", root: "/repo", ref: "auth/T1" }, state)).toBeDefined();
    expect(parsePageMessage({ type: "trace", root: "/repo", ref: "auth/R9" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "trace", root: "/repo", ref: "auth" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "trace", root: "/repo", ref: "billing/R1" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "trace", root: "/other", ref: "auth/R1" }, state)).toBeUndefined();
  });

  it("accepts the commits of the traced item", () => {
    const traced: WorkbenchState = {
      ...state,
      trace: { root: "/repo", ref: "auth/R1", kind: "requirement", title: "Sign in", status: "approved", tasks: [], commits: [{ hash: "fedcba9876", date: "", subject: "", files: [] }] },
    };
    expect(parsePageMessage({ type: "diff", source: "commit", root: "/repo", commit: "fedcba9876", revision: 3 }, traced)).toBeDefined();
    expect(parsePageMessage({ type: "diff", source: "commit", root: "/repo", commit: "fedcba9876", revision: 3 }, state)).toBeUndefined();
  });

  it("accepts commits the state shows, and only as hashes", () => {
    expect(parsePageMessage({ type: "diff", source: "commit", root: "/repo", commit: "abc1234", revision: 3 }, state)).toBeDefined();
    expect(parsePageMessage({ type: "diff", source: "commit", root: "/repo", commit: "def5678", revision: 3 }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "diff", source: "commit", root: "/repo", commit: "HEAD~1", revision: 3 }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "diff", source: "commit", root: "/repo", commit: "--output=/tmp/x", revision: 3 }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "diff", source: "commit", root: "/repo", revision: 3 }, state)).toBeUndefined();
  });
});
