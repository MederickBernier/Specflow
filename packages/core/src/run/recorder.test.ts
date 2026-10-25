import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadSpecTree } from "../load.js";
import type { SpecTree } from "../model.js";
import { NodeFileSystem } from "../node/fs.js";
import { NodeGit } from "../node/git.js";
import { toPosixPath } from "../paths.js";
import type { RunEvent } from "./events.js";
import { changedFiles, recordRun, type RunOutcome } from "./recorder.js";

const cleanRoot = fileURLToPath(new URL("../../../../fixtures/repos/clean", import.meta.url));
const fs = new NodeFileSystem();
let dir = "";

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

/** A fresh copy of the clean fixture repo, with a local identity so commits work anywhere. */
async function repo(mode: "staged" | "auto", trailers = true): Promise<SpecTree> {
  dir = toPosixPath(mkdtempSync(join(tmpdir(), "specflow-recorder-")));
  cpSync(cleanRoot, dir, { recursive: true });
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  const tree = await loadSpecTree(fs, dir);
  if (!tree.ok) throw new Error(tree.error.message);
  return { ...tree.value, config: { ...tree.value.config, commit: { mode, trailers } } };
}

const deps = () => ({ git: new NodeGit({ cwd: dir }), fs });
const t3 = { feature: "accounts", task: "T3" };
const success = (files: string[], summary = "Added the lockout counter."): RunOutcome => ({ ok: true, summary, files });

function changeFiles() {
  writeFileSync(join(dir, "src/auth/login.ts"), "export const changed = true;\n");
  writeFileSync(join(dir, "src/auth/lockout.ts"), "export const attempts = 5;\n");
}

const expectedMessage =
  "feat(accounts): Add lockout counter\n\nAdded the lockout counter.\n\nSpec-Feature: accounts\nSpec-Task: T3\nSpec-Req: R2\n";

describe("recordRun", () => {
  // task-run/R6: staged mode stages and prepares the message, commits nothing.
  it("stages the changed files and writes the prepared message in staged mode", async () => {
    const tree = await repo("staged");
    changeFiles();
    const result = await recordRun(deps(), tree, t3, success(["src/auth/login.ts", "src/auth/lockout.ts"]));

    const messageFile = `${toPosixPath(join(dir, ".git"))}/SPECFLOW_MSG`;
    expect(result).toEqual({
      ok: true,
      value: { mode: "staged", message: expectedMessage, messageFile, files: ["src/auth/login.ts", "src/auth/lockout.ts"] },
    });
    expect(readFileSync(messageFile, "utf8")).toBe(expectedMessage);
    expect(git("diff", "--cached", "--name-only").trim().split("\n")).toEqual(["src/auth/lockout.ts", "src/auth/login.ts"]);
    expect(git("rev-list", "--count", "HEAD").trim()).toBe("1");

    // The prepared message works as is.
    git("commit", "--quiet", "-F", messageFile);
    expect(git("log", "-1", "--format=%(trailers:key=Spec-Task,valueonly)").trim()).toBe("T3");
  });

  // task-run/R6: auto mode commits with all three trailers.
  it("commits with all three trailers in auto mode", async () => {
    const tree = await repo("auto");
    changeFiles();
    const result = await recordRun(deps(), tree, t3, success(["src/auth/login.ts", "src/auth/lockout.ts"]));
    if (!result.ok || result.value.mode !== "auto") throw new Error(JSON.stringify(result));

    expect(result.value.commit).toBe(git("rev-parse", "HEAD").trim());
    expect(git("log", "-1", "--format=%B")).toBe(`${expectedMessage}\n`);
    expect(git("log", "-1", "--format=%(trailers:only,unfold)")).toBe(
      "Spec-Feature: accounts\nSpec-Task: T3\nSpec-Req: R2\n\n",
    );
    expect(git("show", "--name-only", "--format=", "HEAD").trim().split("\n")).toEqual([
      "src/auth/lockout.ts",
      "src/auth/login.ts",
    ]);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("commits only the run's files, leaving other staged changes staged", async () => {
    const tree = await repo("auto");
    writeFileSync(join(dir, "src/index.ts"), "// mine, staged before the run\n");
    git("add", "src/index.ts");
    changeFiles();
    await recordRun(deps(), tree, t3, success(["src/auth/login.ts"]));

    expect(git("show", "--name-only", "--format=", "HEAD").trim()).toBe("src/auth/login.ts");
    expect(git("diff", "--cached", "--name-only").trim()).toBe("src/index.ts");
  });

  it("records deletions and file names with glob characters", async () => {
    const tree = await repo("auto");
    unlinkSync(join(dir, "src/auth/index.ts"));
    writeFileSync(join(dir, "src/auth/[id].ts"), "");
    writeFileSync(join(dir, "src/auth/i.ts"), "");
    await recordRun(deps(), tree, t3, success(["src/auth/index.ts", "src/auth/[id].ts"]));

    expect(git("show", "--name-status", "--format=", "HEAD").trim().split("\n")).toEqual([
      "A\tsrc/auth/[id].ts",
      "D\tsrc/auth/index.ts",
    ]);
    expect(git("status", "--porcelain").trim()).toBe("?? src/auth/i.ts");
  });

  it("records each file once when it is listed twice", async () => {
    const tree = await repo("staged");
    changeFiles();
    const result = await recordRun(deps(), tree, t3, success(["src/auth/login.ts", "src/auth/login.ts"]));
    expect(result.ok && result.value.mode === "staged" && result.value.files).toEqual(["src/auth/login.ts"]);
  });

  it("writes Spec-Req: none for a task with no requirements, and no body without a summary", async () => {
    const tree = await repo("auto");
    writeFileSync(join(dir, "src/auth/index.ts"), "// setup\n");
    await recordRun(deps(), tree, { feature: "accounts", task: "T1" }, { ok: true, files: ["src/auth/index.ts"] });
    expect(git("log", "-1", "--format=%B")).toBe(
      "feat(accounts): Set up the auth module\n\nSpec-Feature: accounts\nSpec-Task: T1\nSpec-Req: none\n\n",
    );
  });

  // task-run/R6, R12: the body is the summary's first paragraph, never its spec notes.
  it("uses the first paragraph of the summary as the body, without spec notes", async () => {
    const tree = await repo("auto");
    changeFiles();
    const summary = "Added the lockout counter.\n\n**Files:**\n- src/auth/login.ts\n\nSpec notes:\n- R2 does not say when the counter resets.";
    await recordRun(deps(), tree, t3, success(["src/auth/login.ts"], summary));
    expect(git("log", "-1", "--format=%B")).toBe(`${expectedMessage}\n`);
  });

  it("leaves trailers out when commit.trailers is false", async () => {
    const tree = await repo("auto", false);
    changeFiles();
    await recordRun(deps(), tree, t3, success(["src/auth/login.ts"]));
    expect(git("log", "-1", "--format=%B")).toBe("feat(accounts): Add lockout counter\n\nAdded the lockout counter.\n\n");
  });

  // task-run/R6: failed or cancelled runs change nothing.
  it.each([
    [{ ok: false, files: ["src/auth/login.ts"] }, "failed"],
    [{ ok: false, cancelled: true, files: ["src/auth/login.ts"] }, "cancelled"],
    [{ ok: true, files: [] }, "no-changes"],
  ] as const)("touches nothing for %j", async (run, reason) => {
    for (const mode of ["staged", "auto"] as const) {
      const tree = await repo(mode);
      changeFiles();
      const head = git("rev-parse", "HEAD");
      const result = await recordRun(deps(), tree, t3, { ...run, files: [...run.files] });

      expect(result).toEqual({ ok: true, value: { mode: "skipped", reason } });
      expect(git("rev-parse", "HEAD")).toBe(head);
      expect(git("diff", "--cached", "--name-only")).toBe("");
      expect(existsSync(join(dir, ".git/SPECFLOW_MSG"))).toBe(false);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on an unknown task without touching git", async () => {
    const tree = await repo("auto");
    changeFiles();
    expect(await recordRun(deps(), tree, { feature: "accounts", task: "T9" }, success(["src/auth/login.ts"]))).toEqual({
      ok: false,
      error: { kind: "unknown-task", message: "No task accounts/T9" },
    });
    expect(git("diff", "--cached", "--name-only")).toBe("");
  });

  it("reports git failures", async () => {
    const tree = await repo("auto");
    const result = await recordRun(deps(), tree, t3, success(["src/auth/does-not-exist.ts"]));
    expect(result).toMatchObject({ ok: false, error: { kind: "git-failed" } });
  });
});

describe("changedFiles", () => {
  it("collects file-changed paths once, in order", () => {
    const events: RunEvent[] = [
      { kind: "file-changed", path: "b.ts", change: "added" },
      { kind: "message", role: "assistant", text: "x" },
      { kind: "file-changed", path: "a.ts", change: "modified" },
      { kind: "file-changed", path: "b.ts", change: "modified" },
    ];
    expect(changedFiles(events)).toEqual(["b.ts", "a.ts"]);
  });
});
