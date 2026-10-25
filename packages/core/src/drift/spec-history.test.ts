import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadSpecTree } from "../load.js";
import { NodeFileSystem } from "../node/fs.js";
import { NodeGit } from "../node/git.js";
import { toPosixPath } from "../paths.js";
import { lastSpecChange } from "./spec-history.js";

const fs = new NodeFileSystem();
const repos = toPosixPath(fileURLToPath(new URL("../../../../fixtures/repos", import.meta.url)));

async function change(root: string, feature: string, id: string) {
  const tree = await loadSpecTree(fs, root);
  if (!tree.ok) throw new Error(tree.error.message);
  const requirement = tree.value.features.find((f) => f.name === feature)!.requirements.find((r) => r.id === id)!;
  const result = await lastSpecChange(new NodeGit({ cwd: root }), tree.value, requirement);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("lastSpecChange on drift fixtures", () => {
  // drift-check/R2
  it("finds the commit that last changed each requirement", async () => {
    const root = `${repos}/drift-spec-changed-since-code`;
    expect((await change(root, "auth", "R2"))?.subject).toBe("docs(specs): sign out ends every session");
    expect((await change(root, "auth", "R1"))?.subject).toBe("docs(specs): auth feature");
  });

  it("ignores a commit that only adds a drift-ack line", async () => {
    expect((await change(`${repos}/drift-acked`, "auth", "R1"))?.subject).toBe("docs(specs): auth feature");
  });

  it("returns hash and date", async () => {
    const found = await change(`${repos}/drift-clean`, "auth", "R1");
    expect(found).toMatchObject({ hash: expect.stringMatching(/^[0-9a-f]{40}$/), date: "2026-02-01T09:00:00+00:00" });
  });
});

describe("lastSpecChange as requirements move", () => {
  const dir = toPosixPath(mkdtempSync(join(tmpdir(), "specflow-spec-history-")));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  let day = 1;
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_DATE: `2026-04-0${day}T10:00:00Z`, GIT_COMMITTER_DATE: `2026-04-0${day}T10:00:00Z` },
    });
  const write = (text: string, message: string) => {
    day++;
    writeFileSync(join(dir, ".specs/a/requirements.md"), text);
    git("add", "-A");
    git("commit", "--quiet", "-m", message);
  };
  const r = (id: string, title: string, body: string) => `## ${id}: ${title}\nstatus: approved\n\n${body}\n\n`;

  it("follows a requirement after content above it moves it down", async () => {
    git("init", "--quiet");
    for (const [k, v] of [["user.name", "T"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) git("config", k!, v!);
    mkdirSync(join(dir, ".specs/a"), { recursive: true });

    write(`# a\n\n${r("R1", "One", "First text.")}${r("R2", "Two", "Second.")}`, "one: create");
    write(`# a\n\n${r("R1", "One", "First text, revised.")}${r("R2", "Two", "Second.")}`, "two: revise R1");
    write(`# a\n\nIntro paragraph\nthat pushes everything down.\n\n${r("R1", "One", "First text, revised.")}${r("R2", "Two", "Second.")}`, "three: add intro");
    write(`# a\n\nIntro paragraph\nthat pushes everything down.\n\n${r("R1", "One", "First text, revised.")}${r("R2", "Two", "Second, revised.")}`, "four: revise R2");

    expect((await change(dir, "a", "R1"))?.subject).toBe("two: revise R1");
    expect((await change(dir, "a", "R2"))?.subject).toBe("four: revise R2");
  });

  it("uses HEAD, not uncommitted edits, and skips uncommitted requirements", async () => {
    writeFileSync(
      join(dir, ".specs/a/requirements.md"),
      `# a\n\n${r("R0", "New", "Not committed.")}Intro paragraph\nthat pushes everything down.\n\n${r("R1", "One", "First text, revised.")}${r("R2", "Two", "Second, revised.")}`,
    );
    expect((await change(dir, "a", "R1"))?.subject).toBe("two: revise R1");
    expect(await change(dir, "a", "R0")).toBeUndefined();
  });
});
