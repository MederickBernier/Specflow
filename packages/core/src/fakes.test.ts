import { describe, expect, it } from "vitest";
import { FakeClock } from "./clock.js";
import { FakeGit, GitCommandError } from "./git.js";
import { FakeProcess, FakeSpawner } from "./spawner.js";

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const items: string[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe("FakeClock", () => {
  it("only moves when told to", () => {
    const clock = new FakeClock("2026-03-01T10:00:00Z");
    expect(clock.now().toISOString()).toBe("2026-03-01T10:00:00.000Z");
    clock.advance(1500);
    expect(clock.now().toISOString()).toBe("2026-03-01T10:00:01.500Z");
    clock.set("2027-01-01T00:00:00Z");
    expect(clock.now().getUTCFullYear()).toBe(2027);
  });
});

describe("FakeGit", () => {
  const git = new FakeGit(({ args }) =>
    args[0] === "status" ? " M a.ts\n?? b.ts\n" : { exitCode: 128, stderr: "fatal: not a git repository\n" },
  );

  it("answers run and records the call", async () => {
    expect(await git.run(["status", "--porcelain"], { cwd: "/repo" })).toEqual({ ok: true, value: " M a.ts\n?? b.ts\n" });
    expect(git.calls.at(-1)).toEqual({ args: ["status", "--porcelain"], cwd: "/repo" });
  });

  it("returns failures as GitError", async () => {
    const result = await git.run(["log"]);
    expect(result).toEqual({
      ok: false,
      error: { args: ["log"], exitCode: 128, stderr: "fatal: not a git repository\n", message: "git log failed: fatal: not a git repository" },
    });
  });

  it("splits answers into lines and throws GitCommandError on failure", async () => {
    expect(await collect(git.lines(["status"]))).toEqual([" M a.ts", "?? b.ts"]);
    await expect(collect(git.lines(["log"]))).rejects.toBeInstanceOf(GitCommandError);
  });
});

describe("FakeSpawner", () => {
  it("plays a script and records the call", async () => {
    const spawner = new FakeSpawner(() => ({ stdout: ["a", "b"], stderr: ["warn"], exit: { code: 3, signal: null } }));
    const process = spawner.spawn("claude", ["-p"], { cwd: "/repo", stdin: "prompt" });
    expect(await collect(process.stdout)).toEqual(["a", "b"]);
    expect(await collect(process.stderr)).toEqual(["warn"]);
    expect(await process.exit).toEqual({ code: 3, signal: null });
    expect(spawner.calls).toEqual([{ command: "claude", args: ["-p"], cwd: "/repo", stdin: "prompt" }]);
  });

  it("hands out a FakeProcess to drive by hand, and records kills", async () => {
    const fake = new FakeProcess();
    const process = new FakeSpawner(() => fake).spawn("claude", [], { cwd: "/repo" });
    fake.writeStdout("started");
    process.kill("SIGTERM");
    fake.writeStdout("ignored after exit");
    expect(await collect(process.stdout)).toEqual(["started"]);
    expect(await process.exit).toEqual({ code: null, signal: "SIGTERM" });
    expect(fake.kills).toEqual(["SIGTERM"]);
  });
});
