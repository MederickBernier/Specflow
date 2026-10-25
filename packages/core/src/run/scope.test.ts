import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config.js";
import type { SpecTree, Task } from "../model.js";
import { checkScope } from "./scope.js";

const tree: SpecTree = { root: "/repo", config: defaultConfig, features: [] };
const task = (files: string[]): Task => ({
  feature: "count",
  id: "T1",
  title: "Count one file",
  reqs: ["R1"],
  status: "doing",
  files,
  depends: [],
  body: "",
  extra: {},
  location: { file: "/repo/.specs/count/tasks.md", startLine: 3, endLine: 7 },
});

describe("checkScope", () => {
  // task-run/R11
  it("flags files matching none of the task's files patterns", () => {
    const report = checkScope(tree, task(["src/count.ts", "test/**"]), [
      "src/count.ts",
      "test/fixtures/notes.txt",
      "src/cli.ts",
      "README.md",
    ]);
    expect(report).toEqual({ specEdits: [], outOfScope: ["src/cli.ts", "README.md"] });
  });

  // task-run/R11: spec edits are listed separately, tasks.md included.
  it("lists changes under the specs folder as spec edits, not out of scope", () => {
    const report = checkScope(tree, task(["src/**"]), [".specs/count/tasks.md", ".specs/count/requirements.md", "src/a.ts"]);
    expect(report).toEqual({ specEdits: [".specs/count/tasks.md", ".specs/count/requirements.md"], outOfScope: [] });
  });

  // task-run/R11: no files list, no out-of-scope check.
  it("skips the out-of-scope check for a task without files", () => {
    expect(checkScope(tree, task([]), ["anything.ts", ".specs/x.md"])).toEqual({ specEdits: [".specs/x.md"], outOfScope: [] });
  });

  it("uses the configured specsDir", () => {
    const custom: SpecTree = { ...tree, config: { ...defaultConfig, specsDir: "docs/specs" } };
    expect(checkScope(custom, task(["src/**"]), ["docs/specs/a/tasks.md", ".specs/stray.md"])).toEqual({
      specEdits: ["docs/specs/a/tasks.md"],
      outOfScope: [".specs/stray.md"],
    });
  });
});
