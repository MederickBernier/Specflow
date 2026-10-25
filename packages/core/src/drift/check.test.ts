import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadSpecTree } from "../load.js";
import type { Finding } from "../model.js";
import { NodeFileSystem } from "../node/fs.js";
import { NodeGit } from "../node/git.js";
import { toPosixPath } from "../paths.js";
import { checkDrift, driftRules } from "./check.js";

const fixtures = toPosixPath(fileURLToPath(new URL("../../../../fixtures", import.meta.url)));
const scenarios = ["clean", "code-changed-since-spec", "spec-changed-since-code", "unimplemented", "acked", "out-of-scope"];

async function drift(root: string, target?: string): Promise<Finding[]> {
  const tree = await loadSpecTree(new NodeFileSystem(), root);
  if (!tree.ok) throw new Error(tree.error.message);
  const result = await checkDrift(new NodeGit({ cwd: root }), tree.value, target ? { target } : {});
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const asExpected = (f: Finding) => ({
  rule: f.rule,
  feature: f.feature,
  id: f.id,
  ...(f.evidence?.file && { file: f.evidence.file }),
  ...(f.evidence?.subject && { commit: f.evidence.subject }),
});

let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

/** A writable copy of a drift fixture, with a local identity. */
function copy(scenario: string): string {
  dir = toPosixPath(mkdtempSync(join(tmpdir(), "specflow-drift-")));
  cpSync(`${fixtures}/repos/drift-${scenario}`, dir, { recursive: true });
  for (const [k, v] of [["user.name", "T"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) {
    execFileSync("git", ["config", k!, v!], { cwd: dir });
  }
  return dir;
}

function commit(root: string, file: string, content: string, message: string) {
  writeFileSync(join(root, file), content);
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", message], { cwd: root });
}

describe("checkDrift", () => {
  it.each(scenarios)("matches fixtures/drift/%s.expected.json", async (scenario) => {
    const expected = JSON.parse(readFileSync(`${fixtures}/drift/${scenario}.expected.json`, "utf8"));
    expect((await drift(`${fixtures}/repos/drift-${scenario}`)).map(asExpected)).toEqual(expected);
  });

  it("runs the rules in the documented order", () => {
    expect(driftRules.map((r) => r.id)).toEqual([
      "drift/code-changed-since-spec",
      "drift/spec-changed-since-code",
      "drift/unimplemented",
    ]);
  });

  it("limits findings to a target", async () => {
    const root = `${fixtures}/repos/drift-code-changed-since-spec`;
    expect(await drift(root, "auth/R1")).toHaveLength(1);
    expect(await drift(root, "auth/R2")).toEqual([]);
    expect(await drift(root, "billing")).toEqual([]);
  });
});

describe("drift-ack", () => {
  // drift-check/R5: findings up to the acked commit are suppressed.
  it("suppresses the acked finding", async () => {
    expect(await drift(`${fixtures}/repos/drift-acked`)).toEqual([]);
  });

  // drift-check/R5: a newer change reports again.
  it("reports again after a newer change", async () => {
    const root = copy("acked");
    commit(root, "src/login.ts", "export const login = (p: string) => p.trim().length > 0;\n", "fix: trim passwords");
    expect((await drift(root)).map(asExpected)).toEqual([
      { rule: "drift/code-changed-since-spec", feature: "auth", id: "R1", file: "src/login.ts", commit: "fix: trim passwords" },
    ]);
  });

  it("accepts a short hash, and ignores an unknown one", async () => {
    const root = copy("code-changed-since-spec");
    const fix = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const requirements = join(root, ".specs/auth/requirements.md");
    const original = readFileSync(requirements, "utf8");

    writeFileSync(requirements, original.replace("status: approved\n", `status: approved\ndrift-ack: ${fix}\n`));
    expect(await drift(root)).toEqual([]);

    writeFileSync(requirements, original.replace("status: approved\n", "status: approved\ndrift-ack: deadbeef\n"));
    expect(await drift(root)).toHaveLength(1);
  });

  it("suppresses unimplemented with any real acked commit", async () => {
    const root = copy("unimplemented");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const requirements = join(root, ".specs/auth/requirements.md");
    writeFileSync(
      requirements,
      readFileSync(requirements, "utf8").replace("## R3: Reset password\npriority: should\nstatus: approved\n", `## R3: Reset password\npriority: should\nstatus: approved\ndrift-ack: ${head}\n`),
    );
    expect(await drift(root)).toEqual([]);
  });
});
