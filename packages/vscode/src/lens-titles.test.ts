import { defaultConfig, type Finding, type Requirement, type SpecTree, type Task, type TraceCommit } from "@specflow/core";
import { describe, expect, it } from "vitest";
import { requirementLensTitle, taskLensTitle } from "./lens-titles.js";

const loc = { file: "/r/.specs/a/x.md", startLine: 1, endLine: 1 };
const req = (id: string): Requirement => ({ feature: "a", id, title: id, status: "approved", body: "", criteria: [], extra: {}, location: loc });
const task = (id: string, reqs: string[], status: Task["status"] = "todo", feature = "a"): Task => ({ feature, id, title: id, reqs, status, files: [], depends: [], body: "", extra: {}, location: loc });
const tree: SpecTree = {
  root: "/r",
  config: defaultConfig,
  features: [
    { name: "a", dir: "/r/.specs/a", requirements: [req("R1"), req("R2")], tasks: [task("T1", ["R1"]), task("T2", ["R1"], "done")], findings: [] },
    { name: "b", dir: "/r/.specs/b", requirements: [], tasks: [task("T1", ["a/R1"], "todo", "b")], findings: [] },
  ],
};
const commit = (date: string, reqs: string[]): TraceCommit => ({ hash: "h", date, subject: "s", files: [], features: [], tasks: [], reqs });
const drift = (id: string): Finding => ({ rule: "drift/x", severity: "warning", message: "m", location: loc, feature: "a", id });

describe("lens titles", () => {
  // vscode-extension/R4
  it("offers to run a task", () => {
    expect(taskLensTitle(task("T3", []))).toBe("$(play) Run T3");
    expect(taskLensTitle(task("T3", [], "done"))).toBe("$(play) Run T3 again");
  });

  // vscode-extension/R7: tasks, last commit date, drift findings.
  it("summarizes a requirement: tasks from any feature, newest commit, drift count", () => {
    const commits = [commit("2026-10-25T10:00:00+00:00", ["a/R1"]), commit("2026-10-01T10:00:00+00:00", ["a/R1"])];
    expect(requirementLensTitle(tree, req("R1"), commits, [drift("R1"), drift("R1"), drift("R2")])).toBe(
      "3 tasks · last commit 2026-10-25 · 2 drift findings",
    );
  });

  it("says when nothing references it, and when drift was not checked", () => {
    expect(requirementLensTitle(tree, req("R2"), [], [])).toBe("0 tasks · no commits · no drift");
    expect(requirementLensTitle(tree, req("R2"), [], undefined)).toBe("0 tasks · no commits · drift not checked");
    expect(requirementLensTitle(tree, req("R2"), [], [drift("R2")])).toBe("0 tasks · no commits · 1 drift finding");
  });
});
