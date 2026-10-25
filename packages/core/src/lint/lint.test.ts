import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../fs.js";
import { loadSpecTree } from "../load.js";
import { NodeFileSystem } from "../node/fs.js";
import { toPosixPath } from "../paths.js";
import { lint, lintRules } from "./lint.js";

async function lintFixture(name: string) {
  const root = toPosixPath(fileURLToPath(new URL(`../../../../fixtures/repos/${name}`, import.meta.url)));
  const tree = await loadSpecTree(new NodeFileSystem(), root);
  if (!tree.ok) throw new Error(tree.error.message);
  return lint(tree.value).map(({ location, ...finding }) => ({
    ...finding,
    file: location.file.slice(root.length + 1),
    line: location.startLine,
  }));
}

async function lintFiles(specs: Record<string, string>) {
  const files = Object.fromEntries(Object.entries(specs).map(([path, text]) => [`/repo/.specs/${path}`, text]));
  const tree = await loadSpecTree(new MemoryFileSystem({ "/repo/.git/HEAD": "", ...files }), "/repo");
  if (!tree.ok) throw new Error(tree.error.message);
  return lint(tree.value);
}

const approved = (id: string, title = "Title") => `## ${id}: ${title}\nstatus: approved\n\n`;

describe("lint on fixtures", () => {
  it("finds nothing in the clean fixture", async () => {
    expect(await lintFixture("clean")).toEqual([]);
  });

  // core-spec-model/R5: each broken fixture produces exactly its finding.
  it.each([
    [
      "malformed-heading",
      {
        rule: "malformed-heading",
        severity: "error",
        message: 'Heading "R3 Remember me" looks like an ID but does not match "## R<n>: <title>"',
        feature: "accounts",
        file: ".specs/accounts/requirements.md",
        line: 29,
      },
    ],
    [
      "duplicate-id",
      {
        rule: "duplicate-id",
        severity: "error",
        message: "Duplicate requirement ID R1 in billing, first defined on line 3",
        feature: "billing",
        id: "R1",
        file: ".specs/billing/requirements.md",
        line: 11,
      },
    ],
    [
      "unknown-ref",
      {
        rule: "unknown-ref",
        severity: "error",
        message: "Task T1 references unknown requirement R7",
        feature: "billing",
        id: "T1",
        file: ".specs/billing/tasks.md",
        line: 3,
      },
    ],
    [
      "dependency-cycle",
      {
        rule: "dependency-cycle",
        severity: "error",
        message: "Dependency cycle: accounts/T1 -> accounts/T3 -> accounts/T2 -> accounts/T1",
        feature: "accounts",
        id: "T1",
        file: ".specs/accounts/tasks.md",
        line: 3,
      },
    ],
    [
      "orphan-requirement",
      {
        rule: "orphan-requirement",
        severity: "warning",
        message: "Approved requirement R2 has no task",
        feature: "billing",
        id: "R2",
        file: ".specs/billing/requirements.md",
        line: 11,
      },
    ],
  ])("%s fixture", async (name, expected) => {
    expect(await lintFixture(name)).toEqual([expected]);
  });
});

describe("lint rules", () => {
  it("runs in the documented order", () => {
    expect(lintRules.map((rule) => rule.id)).toEqual([
      "malformed-heading",
      "duplicate-id",
      "unknown-ref",
      "dependency-cycle",
      "orphan-requirement",
    ]);
  });

  it("returns findings grouped by rule, in rule order", async () => {
    const findings = await lintFiles({
      "a/requirements.md": approved("R1") + approved("R2") + "## R3 bad\n",
      "a/tasks.md": "## T1: One [R1, R9]\n## T1: Again [R1]\n",
    });
    expect(findings.map((f) => f.rule)).toEqual(["malformed-heading", "duplicate-id", "unknown-ref", "orphan-requirement"]);
  });

  it("checks requirement and task IDs separately for duplicates", async () => {
    const findings = await lintFiles({
      "a/requirements.md": approved("R1"),
      "a/tasks.md": "## T1: One [R1]\n## T2: Two [R1]\n## T1: Three [R1]\n## T1: Four [R1]\n",
      "b/tasks.md": "## T1: Other feature []\n",
    });
    expect(findings.map((f) => [f.rule, f.feature, f.id, f.location.startLine])).toEqual([
      ["duplicate-id", "a", "T1", 3],
      ["duplicate-id", "a", "T1", 4],
    ]);
  });

  it("resolves cross-feature requirement references", async () => {
    const findings = await lintFiles({
      "a/requirements.md": approved("R1"),
      "b/tasks.md": "## T1: Uses a [a/R1, a/R2, c/R1]\n",
    });
    expect(findings.map((f) => [f.rule, f.message])).toEqual([
      ["unknown-ref", "Task T1 references unknown requirement a/R2"],
      ["unknown-ref", "Task T1 references unknown requirement c/R1"],
    ]);
  });

  it("only reports approved requirements as orphans", async () => {
    const findings = await lintFiles({
      "a/requirements.md": "## R1: Draft\nstatus: draft\n\n## R2: Removed\nstatus: removed\n\n" + approved("R3"),
    });
    expect(findings.map((f) => [f.rule, f.id])).toEqual([["orphan-requirement", "R3"]]);
  });

  it("finds cycles across features and self-dependencies, once each", async () => {
    const findings = await lintFiles({
      "a/tasks.md": "## T1: A1 []\ndepends: b/T1\n\n## T2: A2 []\ndepends: T2\n\n## T3: A3 []\ndepends: T1, nowhere/T9\n",
      "b/tasks.md": "## T1: B1 []\ndepends: a/T1\n",
    });
    expect(findings.map((f) => [f.rule, f.feature, f.id, f.message])).toEqual([
      ["dependency-cycle", "a", "T1", "Dependency cycle: a/T1 -> b/T1 -> a/T1"],
      ["dependency-cycle", "a", "T2", "Dependency cycle: a/T2 -> a/T2"],
    ]);
  });

  it("reports nothing for an acyclic dependency graph", async () => {
    const findings = await lintFiles({
      "a/tasks.md": "## T1: One []\n## T2: Two []\ndepends: T1\n## T3: Three []\ndepends: T1, T2\n",
    });
    expect(findings).toEqual([]);
  });
});
