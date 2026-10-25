import { defaultConfig, type Feature, type SpecTree } from "@specflow/core";
import { describe, expect, it } from "vitest";
import { explorerNodes } from "./explorer-nodes.js";

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
    { feature: "auth", id: "T2", title: "Setup", reqs: [], status: "doing", files: [], depends: [], body: "", extra: {}, location: loc("/repo/.specs/auth/tasks.md", 9) },
    { feature: "auth", id: "T3", title: "Later", reqs: ["R1", "R2"], status: "blocked", files: [], depends: [], body: "", extra: {}, location: loc("/repo/.specs/auth/tasks.md", 14) },
  ],
  findings: [],
};
const tree: SpecTree = { root: "/repo", config: defaultConfig, features: [feature] };

describe("explorerNodes", () => {
  // vscode-extension/R2: features, then requirements and tasks with status icons.
  it("lists features with their requirements, then tasks", () => {
    const [node] = explorerNodes([{ root: "/repo", name: "repo", tree }]);
    expect(node).toMatchObject({ label: "auth", description: "2 req · 1/3 done", kind: "feature" });
    expect(node!.children.map((c) => [c.label, c.description, c.icon])).toEqual([
      ["R1: Sign in", "approved · must", "verified"],
      ["R2: Remember me", "draft", "edit"],
      ["T1: Login form", "done · R1", "pass"],
      ["T2: Setup", "doing", "sync"],
      ["T3: Later", "blocked · R1, R2", "circle-slash"],
    ]);
  });

  // vscode-extension/R2: clicking opens the item's file at its line.
  it("points each item at its file and line", () => {
    const [node] = explorerNodes([{ root: "/repo", name: "repo", tree }]);
    expect(node!.children.map((c) => [c.location?.file, c.location?.startLine])).toEqual([
      ["/repo/.specs/auth/requirements.md", 3],
      ["/repo/.specs/auth/requirements.md", 12],
      ["/repo/.specs/auth/tasks.md", 3],
      ["/repo/.specs/auth/tasks.md", 9],
      ["/repo/.specs/auth/tasks.md", 14],
    ]);
  });

  it("uses unique ids", () => {
    const [node] = explorerNodes([{ root: "/repo", name: "repo", tree }]);
    const ids = [node!.id, ...node!.children.map((c) => c.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("groups by root when there are several", () => {
    const nodes = explorerNodes([
      { root: "/a", name: "a", tree: { ...tree, root: "/a" } },
      { root: "/b", name: "b", error: "commit.mode: Invalid option" },
    ]);
    expect(nodes.map((n) => [n.label, n.kind])).toEqual([["a", "root"], ["b", "root"]]);
    expect(nodes[1]!.children).toEqual([
      expect.objectContaining({ kind: "error", label: "Specs could not be loaded", description: "commit.mode: Invalid option" }),
    ]);
  });
});
