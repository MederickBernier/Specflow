import { describe, expect, it } from "vitest";
import { parsePageMessage, type WorkbenchState } from "./protocol.js";

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
          tasks: [{ id: "T1", title: "Login form", status: "todo", reqs: ["R1"], depends: [], line: 3 }],
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
    expect(parsePageMessage({ type: "diff", source: "review", root: "/repo" }, state)).toBeDefined();
    expect(parsePageMessage({ type: "diff", source: "review", root: "/repo", path: "src/a.ts" }, state)).toBeDefined();
    expect(parsePageMessage({ type: "diff", source: "review", root: "/repo", path: "src/other.ts" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "diff", source: "review", root: "/repo", commit: "abc1234" }, state)).toBeUndefined();
  });

  it("accepts the whole working tree, but no single path the state does not show", () => {
    expect(parsePageMessage({ type: "diff", source: "working", root: "/repo" }, state)).toBeDefined();
    expect(parsePageMessage({ type: "diff", source: "working", root: "/repo", path: "src/a.ts" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "diff", source: "working", root: "/elsewhere" }, state)).toBeUndefined();
  });

  it("accepts commits the state shows, and only as hashes", () => {
    expect(parsePageMessage({ type: "diff", source: "commit", root: "/repo", commit: "abc1234" }, state)).toBeDefined();
    expect(parsePageMessage({ type: "diff", source: "commit", root: "/repo", commit: "def5678" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "diff", source: "commit", root: "/repo", commit: "HEAD~1" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "diff", source: "commit", root: "/repo", commit: "--output=/tmp/x" }, state)).toBeUndefined();
    expect(parsePageMessage({ type: "diff", source: "commit", root: "/repo" }, state)).toBeUndefined();
  });
});
