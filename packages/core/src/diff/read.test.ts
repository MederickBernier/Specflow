import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystem } from "../node/fs.js";
import { NodeGit } from "../node/git.js";
import { toPosixPath } from "../paths.js";
import { diffLimits, readCommitDiff, readWorkingDiff } from "./read.js";

const fs = new NodeFileSystem();
const git = new NodeGit();
let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args: string[]) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd: dir, encoding: "utf8" });
const write = (file: string, content: string) => {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), content);
};

/** A repo with one commit: a.txt, b.txt, src/c.txt. */
function repo(): string {
  dir = toPosixPath(mkdtempSync(join(tmpdir(), "specflow-diff-")));
  run("init", "--quiet");
  run("config", "user.name", "T");
  run("config", "user.email", "t@example.com");
  write("a.txt", "one\ntwo\n");
  write("b.txt", "keep\n");
  write("src/c.txt", "c\n");
  run("add", "-A");
  run("commit", "--quiet", "-m", "init");
  return dir;
}

describe("readWorkingDiff (workbench-ui/R4)", () => {
  it("diffs staged and unstaged changes against HEAD, with untracked files as added", async () => {
    repo();
    write("a.txt", "one\nTWO\n");
    run("add", "a.txt");
    write("b.txt", "keep\nmore\n");
    write("new/d.txt", "d1\nd2");
    write("ignored.log", "x\n");
    write(".gitignore", "*.log\n");
    const result = await readWorkingDiff(git, fs, dir);
    expect(result.ok && result.value.truncated).toBe(false);
    const files = result.ok ? result.value.files : [];
    expect(files.map((f) => [f.path, f.change, f.additions, f.deletions])).toEqual([
      [".gitignore", "added", 1, 0],
      ["a.txt", "modified", 1, 1],
      ["b.txt", "modified", 1, 0],
      ["new/d.txt", "added", 2, 0],
    ]);
    expect(files[3]!.hunks).toEqual([
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 2,
        lines: [
          { kind: "add", text: "d1", newLine: 1 },
          { kind: "add", text: "d2", newLine: 2, noNewline: true },
        ],
      },
    ]);
  });

  it("never changes the index", async () => {
    repo();
    write("a.txt", "changed\n");
    write("untracked.txt", "u\n");
    const index = readFileSync(join(dir, ".git/index"));
    await readWorkingDiff(git, fs, dir);
    expect(readFileSync(join(dir, ".git/index")).equals(index)).toBe(true);
    expect(run("diff", "--cached", "--name-only")).toBe("");
    expect(run("status", "--porcelain")).toBe(" M a.txt\n?? untracked.txt\n");
  });

  it("narrows to the given paths, taking them literally", async () => {
    repo();
    write("a.txt", "x\n");
    write("b.txt", "y\n");
    // As a glob, [a].txt would match a.txt.
    write("[a].txt", "brackets\n");
    const result = await readWorkingDiff(git, fs, dir, { paths: ["b.txt", "[a].txt"] });
    expect(result.ok && result.value.files.map((f) => f.path)).toEqual(["[a].txt", "b.txt"]);
  });

  it("reports deletions, renames and binary files", async () => {
    repo();
    run("rm", "--quiet", "b.txt");
    run("mv", "src/c.txt", "src/moved.txt");
    writeFileSync(join(dir, "bin.dat"), Buffer.from([0, 1, 2, 3]));
    const result = await readWorkingDiff(git, fs, dir);
    const files = result.ok ? result.value.files : [];
    expect(files.map((f) => [f.path, f.change, f.from, f.binary])).toEqual([
      ["b.txt", "deleted", undefined, false],
      ["bin.dat", "added", undefined, true],
      ["src/moved.txt", "renamed", "src/c.txt", false],
    ]);
  });

  it("is relative to a root below the repository's top level", async () => {
    repo();
    write("src/c.txt", "changed\n");
    write("src/new.txt", "n\n");
    write("a.txt", "outside\n");
    const result = await readWorkingDiff(git, fs, `${dir}/src`);
    expect(result.ok && result.value.files.map((f) => f.path)).toEqual(["c.txt", "new.txt"]);
  });

  it("works in a repository without commits", async () => {
    dir = toPosixPath(mkdtempSync(join(tmpdir(), "specflow-diff-")));
    run("init", "--quiet");
    write("first.txt", "hello\n");
    run("add", "first.txt");
    write("loose.txt", "x\n");
    const result = await readWorkingDiff(git, fs, dir);
    expect(result.ok && result.value.files.map((f) => [f.path, f.change])).toEqual([
      ["first.txt", "added"],
      ["loose.txt", "added"],
    ]);
  });

  it("returns files over the limits without their hunks, and stops at the total", async () => {
    repo();
    const limits = { fileLines: 10, fileBytes: 200, totalBytes: 400 };
    write("a.txt", Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") + "\n");
    write("b.txt", `${"x".repeat(300)}\n`);
    write("many.txt", Array.from({ length: 12 }, (_, i) => `u${i}`).join("\n") + "\n");
    write("wide.txt", `${"w".repeat(250)}\n`);
    const result = await readWorkingDiff(git, fs, dir, { limits });
    const files = result.ok ? result.value.files : [];
    expect(files.map((f) => [f.path, f.tooLarge ?? false, f.hunks.length, f.additions])).toEqual([
      ["a.txt", true, 0, 20],
      ["b.txt", true, 0, 1],
      ["many.txt", true, 0, 12],
      ["wide.txt", true, 0, 0],
    ]);

    write("a.txt", "small\n");
    write("b.txt", "small\n");
    for (const name of ["u1", "u2", "u3", "u4", "u5"]) write(`${name}.txt`, `${"z".repeat(150)}\n`);
    rmSync(join(dir, "many.txt"));
    rmSync(join(dir, "wide.txt"));
    const capped = await readWorkingDiff(git, fs, dir, { limits });
    expect(capped.ok && capped.value.truncated).toBe(true);
    expect(capped.ok && capped.value.files.map((f) => f.path)).toEqual(["a.txt", "b.txt", "u1.txt"]);
  });

  it("uses limits of 5,000 lines, 1 MB per file and 10 MB in all by default", () => {
    expect(diffLimits).toEqual({ fileLines: 5_000, fileBytes: 1_000_000, totalBytes: 10_000_000 });
  });

  it("ignores diff settings that would change the patch format", async () => {
    repo();
    run("config", "diff.noprefix", "true");
    run("config", "diff.mnemonicPrefix", "true");
    run("config", "color.diff", "always");
    write("a.txt", "one\nchanged\n");
    const result = await readWorkingDiff(git, fs, dir);
    expect(result.ok && result.value.files.map((f) => [f.path, f.additions])).toEqual([["a.txt", 1]]);
  });

  it("returns git's error outside a repository", async () => {
    dir = toPosixPath(mkdtempSync(join(tmpdir(), "specflow-diff-")));
    const result = await readWorkingDiff(git, fs, dir);
    expect(result.ok).toBe(false);
  });
});

describe("readCommitDiff (workbench-ui/R5)", () => {
  it("diffs a commit against its parent, and a root commit against the empty tree", async () => {
    repo();
    const root = run("rev-parse", "HEAD").trim();
    write("a.txt", "one\nchanged\n");
    chmodSync(join(dir, "src/c.txt"), 0o755);
    run("commit", "--quiet", "-am", "second");
    const second = run("rev-parse", "HEAD").trim();

    const changed = await readCommitDiff(git, dir, second);
    expect(changed.ok && changed.value.files.map((f) => [f.path, f.change, f.additions, f.deletions])).toEqual(
      process.platform === "win32"
        ? [["a.txt", "modified", 1, 1]]
        : [
            ["a.txt", "modified", 1, 1],
            ["src/c.txt", "modified", 0, 0],
          ],
    );
    const first = await readCommitDiff(git, dir, root.slice(0, 7));
    expect(first.ok && first.value.files.map((f) => [f.path, f.change])).toEqual([
      ["a.txt", "added"],
      ["b.txt", "added"],
      ["src/c.txt", "added"],
    ]);
  });

  it("refuses anything but a hash", async () => {
    repo();
    for (const commit of ["HEAD", "HEAD~1", "--output=/tmp/x", "main"]) {
      const result = await readCommitDiff(git, dir, commit);
      expect(result.ok, commit).toBe(false);
    }
  });

  it("returns git's error for an unknown commit", async () => {
    repo();
    expect((await readCommitDiff(git, dir, "0000000000000000000000000000000000000000")).ok).toBe(false);
  });
});
