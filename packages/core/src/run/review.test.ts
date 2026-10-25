import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadSpecTree } from "../load.js";
import type { SpecTree } from "../model.js";
import { NodeFileSystem } from "../node/fs.js";
import { NodeGit } from "../node/git.js";
import { toPosixPath } from "../paths.js";
import { recordRun } from "./recorder.js";
import { acceptRecording, discardRecording, type StagedRecording } from "./review.js";
import { setTaskStatus, type StatusSnapshot, tasksFile } from "./status.js";

const fs = new NodeFileSystem();
let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
const read = (file: string) => readFileSync(join(dir, file), "utf8");

/** A staged run of accounts/T3 on a copy of the clean fixture: login.ts changed, lockout.ts added. */
async function stagedRun(): Promise<{ tree: SpecTree; recording: StagedRecording; snapshot: StatusSnapshot; deps: { git: NodeGit; fs: NodeFileSystem } }> {
  dir = toPosixPath(mkdtempSync(join(tmpdir(), "specflow-review-")));
  cpSync(fileURLToPath(new URL("../../../../fixtures/repos/clean", import.meta.url)), dir, { recursive: true });
  for (const [k, v] of [["user.name", "T"], ["user.email", "t@example.com"], ["commit.gpgsign", "false"]]) git("config", k!, v!);
  const loaded = await loadSpecTree(fs, dir);
  if (!loaded.ok) throw new Error(loaded.error.message);
  const tree = loaded.value;
  const target = { feature: "accounts", task: "T3" };
  const doing = await setTaskStatus(fs, tree, target, "doing");
  if (!doing.ok) throw new Error(doing.error.message);
  writeFileSync(join(dir, "src/auth/login.ts"), "export const changed = true;\n");
  writeFileSync(join(dir, "src/auth/lockout.ts"), "export const attempts = 5;\n");
  await setTaskStatus(fs, tree, target, "done");
  const deps = { git: new NodeGit({ cwd: dir }), fs };
  const recorded = await recordRun(deps, tree, target, {
    ok: true,
    summary: "Added the counter.",
    files: ["src/auth/login.ts", "src/auth/lockout.ts", tasksFile(tree, "accounts")],
  });
  if (!recorded.ok || recorded.value.mode !== "staged") throw new Error("expected a staged recording");
  return { tree, recording: recorded.value, snapshot: doing.value, deps };
}

describe("acceptRecording", () => {
  // vscode-extension/R5: accept commits with the prepared trailers.
  it("commits the run's files with the prepared message", async () => {
    const { tree, recording, deps } = await stagedRun();
    const result = await acceptRecording(deps, tree, recording);
    expect(result.ok && result.value).toBe(git("rev-parse", "HEAD").trim());
    expect(git("log", "-1", "--format=%(trailers:only,unfold)")).toBe("Spec-Feature: accounts\nSpec-Task: T3\nSpec-Req: R2\n\n");
    expect(git("show", "--name-only", "--format=", "HEAD").trim().split("\n")).toEqual([
      ".specs/accounts/tasks.md",
      "src/auth/lockout.ts",
      "src/auth/login.ts",
    ]);
    expect(git("status", "--porcelain")).toBe("");
    expect(read(".git/SPECFLOW_MSG")).toBe("");
  });

  it("includes edits made while reviewing, and leaves other staged files alone", async () => {
    const { tree, recording, deps } = await stagedRun();
    writeFileSync(join(dir, "src/auth/lockout.ts"), "export const attempts = 6; // reviewed\n");
    writeFileSync(join(dir, "src/index.ts"), "// mine\n");
    git("add", "src/index.ts");
    await acceptRecording(deps, tree, recording);
    expect(git("show", "HEAD:src/auth/lockout.ts")).toBe("export const attempts = 6; // reviewed\n");
    expect(git("diff", "--cached", "--name-only").trim()).toBe("src/index.ts");
  });
});

describe("discardRecording", () => {
  // vscode-extension/R5, task-run/R7: discard restores the files and the task status.
  it("restores changed files, removes added ones and restores the status line", async () => {
    const { tree, recording, snapshot, deps } = await stagedRun();
    const originalLogin = git("show", "HEAD:src/auth/login.ts");
    const originalTasks = git("show", "HEAD:.specs/accounts/tasks.md");

    expect(await discardRecording(deps, tree, recording, snapshot)).toEqual({ ok: true, value: undefined });
    expect(read("src/auth/login.ts")).toBe(originalLogin);
    expect(existsSync(join(dir, "src/auth/lockout.ts"))).toBe(false);
    expect(read(".specs/accounts/tasks.md")).toBe(originalTasks);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("leaves changes outside the recording alone", async () => {
    const { tree, recording, snapshot, deps } = await stagedRun();
    writeFileSync(join(dir, "src/index.ts"), "// mine\n");
    await discardRecording(deps, tree, recording, snapshot);
    expect(git("status", "--porcelain").trim()).toBe("M src/index.ts");
  });
});
