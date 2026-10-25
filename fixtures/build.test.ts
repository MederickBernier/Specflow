import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { buildFixtures } from "./build.ts";
import { driftScenarios } from "./drift/scenarios.ts";

const lintRules = ["dependency-cycle", "duplicate-id", "malformed-heading", "orphan-requirement", "unknown-ref"];

// realpath expands short 8.3 names on Windows, which git never prints.
const here = dirname(fileURLToPath(import.meta.url));
const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "specflow-fixtures-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("buildFixtures", () => {
  const first = buildFixtures(join(tmp, "a"));
  const second = buildFixtures(join(tmp, "b"));

  const lintFixtures = ["clean", ...lintRules].sort();

  it("builds clean plus one fixture per lint rule, and the drift fixtures", () => {
    expect(Object.keys(first)).toEqual([...lintFixtures, ...driftScenarios.map((s) => `drift-${s.name}`)]);
  });

  it("makes each lint fixture its own repo with one commit and a clean tree", () => {
    for (const name of lintFixtures) {
      const path = first[name]!;
      expect(git(path, "rev-parse", "--show-toplevel")).toBe(path.replace(/\\/g, "/"));
      expect(git(path, "rev-list", "--count", "HEAD")).toBe("1");
      expect(git(path, "status", "--porcelain")).toBe("");
    }
  });

  it("builds each drift scenario as one commit per step with a clean tree", () => {
    for (const scenario of driftScenarios) {
      const path = first[`drift-${scenario.name}`]!;
      expect(git(path, "rev-list", "--count", "HEAD"), scenario.name).toBe(String(scenario.steps.length));
      expect(git(path, "status", "--porcelain"), scenario.name).toBe("");
    }
  });

  it("writes the acked scenario's drift-ack with the hash of the fix commit", () => {
    const path = first["drift-acked"]!;
    const fix = git(path, "log", "--format=%H", "--grep=^fix: reject empty passwords$");
    expect(git(path, "show", "HEAD:.specs/auth/requirements.md")).toContain(`drift-ack: ${fix}`);
  });

  it("has a valid expected.json for every drift scenario", () => {
    const rules = ["drift/code-changed-since-spec", "drift/spec-changed-since-code", "drift/unimplemented"];
    for (const scenario of driftScenarios) {
      const expected = JSON.parse(readFileSync(join(here, "drift", `${scenario.name}.expected.json`), "utf8"));
      expect(Array.isArray(expected), scenario.name).toBe(true);
      for (const finding of expected) expect(rules).toContain(finding.rule);
    }
  });

  it("produces identical commits on every build", () => {
    for (const name of Object.keys(first)) {
      expect(git(second[name]!, "rev-parse", "HEAD"), name).toBe(git(first[name]!, "rev-parse", "HEAD"));
    }
  });

  it("changes exactly one spec file per broken fixture", () => {
    const tree = (path: string) => new Set(git(path, "ls-tree", "-r", "HEAD").split("\n"));
    const clean = tree(first.clean!);
    for (const rule of lintRules) {
      const changed = [...tree(first[rule]!)].filter((entry) => !clean.has(entry));
      expect(changed, rule).toHaveLength(1);
      expect(changed[0], rule).toMatch(/\t\.specs\/[a-z]+\/(requirements|tasks)\.md$/);
    }
  });
});
