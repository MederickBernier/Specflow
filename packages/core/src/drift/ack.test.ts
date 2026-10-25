import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadSpecTree } from "../load.js";
import type { SpecTree } from "../model.js";
import { NodeFileSystem } from "../node/fs.js";
import { NodeGit } from "../node/git.js";
import { toPosixPath } from "../paths.js";
import { ackDrift } from "./ack.js";
import { checkDrift } from "./check.js";

const fs = new NodeFileSystem();
const git = new NodeGit();
let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const requirements = () => readFileSync(join(dir, ".specs/auth/requirements.md"), "utf8");
const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });

/** A copy of the code-changed-since-spec fixture, whose auth/R1 has one finding. */
async function fixture(): Promise<SpecTree> {
  dir = toPosixPath(mkdtempSync(join(tmpdir(), "specflow-ack-")));
  cpSync(fileURLToPath(new URL("../../../../fixtures/repos/drift-code-changed-since-spec", import.meta.url)), dir, { recursive: true });
  return load();
}
async function load(): Promise<SpecTree> {
  const loaded = await loadSpecTree(fs, dir);
  if (!loaded.ok) throw new Error(loaded.error.message);
  return loaded.value;
}

describe("ackDrift (workbench-ui/R7)", () => {
  it("writes the full hash after the heading, changing no other line", async () => {
    const tree = await fixture();
    const before = requirements();
    const short = run("rev-parse", "--short", "HEAD").trim();
    const full = run("rev-parse", "HEAD").trim();
    const result = await ackDrift(fs, git, tree, "auth/R1", short);
    expect(result).toEqual({ ok: true, value: { feature: "auth", id: "R1", file: `${dir}/.specs/auth/requirements.md`, commit: full } });
    const lines = before.split("\n");
    const heading = lines.findIndex((l) => l.startsWith("## R1:"));
    lines.splice(heading + 1, 0, `drift-ack: ${full}`);
    expect(requirements()).toBe(lines.join("\n"));
  });

  it("replaces an earlier acknowledgement", async () => {
    const tree = await fixture();
    const first = run("rev-list", "--max-parents=0", "HEAD").trim();
    await ackDrift(fs, git, tree, "auth/R1", first);
    const afterFirst = requirements();
    const result = await ackDrift(fs, git, await load(), "auth/R1", "HEAD");
    const head = run("rev-parse", "HEAD").trim();
    expect(result.ok && result.value).toMatchObject({ commit: head, previous: first });
    expect(requirements()).toBe(afterFirst.replace(first, head));
  });

  it("suppresses the finding it acknowledges", async () => {
    const tree = await fixture();
    const findings = await checkDrift(git, tree);
    const commit = findings.ok ? findings.value[0]?.evidence?.commit : undefined;
    expect(commit).toBeDefined();
    await ackDrift(fs, git, tree, "auth/R1", commit!);
    const after = await checkDrift(git, await load());
    expect(after.ok && after.value).toEqual([]);
  });

  it("writes nothing for an unknown requirement", async () => {
    const tree = await fixture();
    const before = requirements();
    for (const ref of ["auth/R9", "nowhere/R1", "R1", "auth/T1", "auth/"]) {
      const result = await ackDrift(fs, git, tree, ref, "HEAD");
      expect(result.ok, ref).toBe(false);
      expect(!result.ok && result.error.kind, ref).toBe("unknown-requirement");
    }
    expect(requirements()).toBe(before);
  });

  it("writes nothing for a commit git cannot resolve", async () => {
    const tree = await fixture();
    const before = requirements();
    const tree1 = run("rev-parse", "HEAD^{tree}").trim();
    for (const commit of ["0000000", "no-such-branch", "--output=x", tree1, ""]) {
      const result = await ackDrift(fs, git, tree, "auth/R1", commit);
      expect(!result.ok && result.error.kind, commit).toBe("unknown-commit");
    }
    expect(requirements()).toBe(before);
  });

  it("keeps CRLF line endings", async () => {
    const tree = await fixture();
    writeFileSync(join(dir, ".specs/auth/requirements.md"), requirements().replaceAll("\n", "\r\n"));
    await ackDrift(fs, git, await load(), "auth/R1", "HEAD");
    expect(requirements()).not.toMatch(/[^\r]\n/);
    expect(requirements()).toMatch(/drift-ack: [0-9a-f]{40}\r\n/);
    expect(tree.root).toBe(dir);
  });
});
