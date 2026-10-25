import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitCommandError } from "../git.js";
import { NodeGit } from "./git.js";

// Identity and signing set per call, so the user's global git config cannot interfere.
const config = ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"];

let repo = "";
let git: NodeGit;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "specflow-git-"));
  git = new NodeGit({ cwd: repo });
  await git.run(["init", "--quiet"]);
  for (const name of ["a", "b", "c"]) {
    await writeFile(join(repo, `${name}.txt`), `${name}\r\nline two\n`);
    await git.run(["add", `${name}.txt`]);
    await git.run([...config, "commit", "--quiet", "-m", `add ${name}`]);
  }
});

afterAll(() => rm(repo, { recursive: true, force: true }));

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const items: string[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe("NodeGit", () => {
  it("returns stdout exactly, including line endings", async () => {
    expect(await git.run(["-c", "core.autocrlf=false", "show", "HEAD:a.txt"])).toEqual({ ok: true, value: "a\r\nline two\n" });
  });

  it("passes stdin", async () => {
    expect(await git.run(["hash-object", "--stdin"], { stdin: "hello\n" })).toEqual({
      ok: true,
      value: "ce013625030ba8dba906f756967f9e9ca394464a\n",
    });
  });

  it("returns a GitError on failure", async () => {
    const result = await git.run(["rev-parse", "--verify", "no-such-ref"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({ args: ["rev-parse", "--verify", "no-such-ref"], exitCode: 128 });
    expect(!result.ok && result.error.message).toMatch(/^git rev-parse --verify no-such-ref failed: fatal: /);
  });

  it("uses the per-call cwd over the default", async () => {
    const result = await new NodeGit({ cwd: tmpdir() }).run(["rev-parse", "--show-toplevel"], { cwd: repo });
    expect(result.ok).toBe(true);
  });

  it("streams lines", async () => {
    expect(await collect(git.lines(["log", "--format=%s"]))).toEqual(["add c", "add b", "add a"]);
  });

  it("throws GitCommandError after the lines when git fails", async () => {
    await expect(collect(git.lines(["log", "no-such-ref"]))).rejects.toBeInstanceOf(GitCommandError);
  });

  it("stops git when the consumer stops early", async () => {
    for await (const line of git.lines(["log", "--format=%s"])) {
      expect(line).toBe("add c");
      break;
    }
    // Still usable afterwards.
    expect((await git.run(["status", "--porcelain"])).ok).toBe(true);
  });
});
