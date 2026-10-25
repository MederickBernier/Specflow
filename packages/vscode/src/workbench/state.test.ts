import { defaultConfig, type Feature, type Finding, lint, type SpecTree } from "@specflow/core";
import { describe, expect, it } from "vitest";
import { buildWorkbenchState, type WorkbenchInputs } from "./state.js";

const loc = (file: string, line: number) => ({ file, startLine: line, endLine: line + 3 });
const feature: Feature = {
  name: "auth",
  dir: "/repo/.specs/auth",
  requirements: [
    { feature: "auth", id: "R1", title: "Sign in", priority: "must", status: "approved", body: "", criteria: [], extra: {}, location: loc("/repo/.specs/auth/requirements.md", 3) },
    { feature: "auth", id: "R2", title: "Remember me", status: "draft", body: "", criteria: [], extra: {}, location: loc("/repo/.specs/auth/requirements.md", 12) },
  ],
  tasks: [
    { feature: "auth", id: "T1", title: "Login form", reqs: ["R1"], status: "done", files: ["src/a.ts"], depends: [], body: "", extra: {}, location: loc("/repo/.specs/auth/tasks.md", 3) },
    { feature: "auth", id: "T2", title: "Cookie", reqs: ["R2", "R9"], status: "todo", files: [], depends: ["T1"], body: "", extra: {}, location: loc("/repo/.specs/auth/tasks.md", 9) },
  ],
  findings: [],
};
const tree: SpecTree = { root: "/repo", config: defaultConfig, features: [feature] };
const finding: Finding = {
  rule: "drift/code-changed-since-spec",
  severity: "warning",
  message: 'src/a.ts changed in abc1234 "fix: trim"',
  location: loc("/repo/.specs/auth/requirements.md", 3),
  feature: "auth",
  id: "R1",
  evidence: { file: "src/a.ts", commit: "abc1234", subject: "fix: trim" },
};

const inputs = (overrides: Partial<WorkbenchInputs> = {}): WorkbenchInputs => ({
  roots: [{ root: "/repo", name: "repo", tree, insights: { commits: [] } }],
  ...overrides,
});

describe("buildWorkbenchState (workbench-ui/R1)", () => {
  it("carries each feature's requirements and tasks with their lines", () => {
    const state = buildWorkbenchState(inputs(), 7);
    expect(state.revision).toBe(7);
    expect(state.roots[0]!.features).toEqual([
      {
        name: "auth",
        requirements: [
          { id: "R1", title: "Sign in", status: "approved", priority: "must", line: 3 },
          { id: "R2", title: "Remember me", status: "draft", line: 12 },
        ],
        tasks: [
          { id: "T1", title: "Login form", status: "done", reqs: ["R1"], depends: [], waitingOn: [], line: 3 },
          { id: "T2", title: "Cookie", status: "todo", reqs: ["R2", "R9"], depends: ["T1"], waitingOn: [], line: 9 },
        ],
      },
    ]);
  });

  // workbench-ui/R3: a task waits on dependencies that are not done, in its feature or another.
  it("names the dependencies a task is waiting on", () => {
    const task = (feature: string, id: string, status: "todo" | "done", depends: string[] = []) => ({
      feature, id, title: id, reqs: [], status, files: [], depends, body: "", extra: {}, location: loc(`/repo/.specs/${feature}/tasks.md`, 3),
    });
    const waiting: SpecTree = {
      root: "/repo",
      config: defaultConfig,
      features: [
        { name: "billing", dir: "/repo/.specs/billing", requirements: [], findings: [], tasks: [task("billing", "T1", "todo"), task("billing", "T2", "done")] },
        {
          name: "auth",
          dir: "/repo/.specs/auth",
          requirements: [],
          findings: [],
          tasks: [task("auth", "T1", "done"), task("auth", "T2", "todo"), task("auth", "T3", "todo", ["T1", "T2", "billing/T1", "billing/T2", "T9", "nowhere/T1"])],
        },
      ],
    };
    const state = buildWorkbenchState({ roots: [{ root: "/repo", name: "repo", tree: waiting }] }, 1);
    const t3 = state.roots[0]!.features[1]!.tasks[2]!;
    expect(t3.depends).toEqual(["T1", "T2", "billing/T1", "billing/T2", "T9", "nowhere/T1"]);
    expect(t3.waitingOn).toEqual(["T2", "billing/T1"]);
  });

  it("counts lint problems", () => {
    const count = lint(tree).length;
    expect(count).toBeGreaterThan(0);
    expect(buildWorkbenchState(inputs(), 1).roots[0]!.lintProblems).toBe(count);
  });

  it("shows a load error instead of the last good tree", () => {
    const state = buildWorkbenchState({ roots: [{ root: "/repo", name: "repo", tree, error: "config.yml: bad version" }] }, 1);
    expect(state.roots[0]).toEqual({ root: "/repo", name: "repo", error: "config.yml: bad version", features: [], lintProblems: 0, drift: { checked: false } });
  });

  it("says drift was not checked until it was, then lists the findings with their evidence", () => {
    expect(buildWorkbenchState(inputs(), 1).roots[0]!.drift).toEqual({ checked: false });
    const checked = buildWorkbenchState(inputs({ roots: [{ root: "/repo", name: "repo", tree, insights: { commits: [], drift: [finding] } }] }), 1);
    expect(checked.roots[0]!.drift).toEqual({
      checked: true,
      findings: [
        {
          rule: "drift/code-changed-since-spec",
          severity: "warning",
          message: 'src/a.ts changed in abc1234 "fix: trim"',
          feature: "auth",
          id: "R1",
          line: 3,
          file: "src/a.ts",
          commit: "abc1234",
          subject: "fix: trim",
        },
      ],
    });
  });

  it("passes on why history could not be read", () => {
    const state = buildWorkbenchState(inputs({ roots: [{ root: "/repo", name: "repo", tree, insights: { commits: [], error: "not a git repository" } }] }), 1);
    expect(state.roots[0]!.historyError).toBe("not a git repository");
  });

  it("reports harness health", () => {
    expect(buildWorkbenchState(inputs(), 1).harness).toEqual({ state: "unknown" });
    expect(buildWorkbenchState(inputs({ harness: { ready: true, harness: "claude-code", version: "2.1.3", warnings: [] } }), 1).harness).toEqual({
      state: "ready",
      name: "claude-code",
      version: "2.1.3",
      warnings: [],
    });
    const problem = { ready: false, harness: "claude-code", message: "Specflow can't run tasks: not found", installUrl: "https://example.test/setup" };
    expect(buildWorkbenchState(inputs({ harness: problem }), 1).harness).toEqual({
      state: "problem",
      name: "claude-code",
      message: "Specflow can't run tasks: not found",
      installUrl: "https://example.test/setup",
    });
  });

  it("includes the latest run and marks review files outside the task's files", () => {
    const state = buildWorkbenchState(
      inputs({
        run: { target: "auth/T2", status: "done" },
        review: {
          root: "/repo",
          target: "auth/T2",
          files: [
            { path: "src/a.ts", change: "modified" },
            { path: "src/b.ts", change: "added" },
          ],
          outOfScope: ["src/b.ts"],
          specNotes: ["R2 does not say how long the cookie lasts"],
        },
      }),
      1,
    );
    expect(state.run).toEqual({ target: "auth/T2", status: "done" });
    expect(state.review).toEqual({
      root: "/repo",
      target: "auth/T2",
      files: [
        { path: "src/a.ts", change: "modified", outOfScope: false },
        { path: "src/b.ts", change: "added", outOfScope: true },
      ],
      specNotes: ["R2 does not say how long the cookie lasts"],
    });
  });

  it("is plain JSON", () => {
    const state = buildWorkbenchState(inputs({ roots: [{ root: "/repo", name: "repo", tree, insights: { commits: [], drift: [finding] } }] }), 1);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
