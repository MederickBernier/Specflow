import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildFixtures } from "./build.ts";

const lintRules = ["dependency-cycle", "duplicate-id", "malformed-heading", "orphan-requirement", "unknown-ref"];

const tmp = mkdtempSync(join(tmpdir(), "specflow-fixtures-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("buildFixtures", () => {
  const first = buildFixtures(join(tmp, "a"));
  const second = buildFixtures(join(tmp, "b"));

  it("builds clean plus one fixture per lint rule", () => {
    expect(Object.keys(first)).toEqual(["clean", ...lintRules].sort());
  });

  it("makes each fixture its own repo with one commit and a clean tree", () => {
    for (const path of Object.values(first)) {
      expect(git(path, "rev-parse", "--show-toplevel")).toBe(path);
      expect(git(path, "rev-list", "--count", "HEAD")).toBe("1");
      expect(git(path, "status", "--porcelain")).toBe("");
    }
  });

  it("produces identical commits on every build", () => {
    for (const name of Object.keys(first)) {
      expect(git(second[name]!, "rev-parse", "HEAD")).toBe(git(first[name]!, "rev-parse", "HEAD"));
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
