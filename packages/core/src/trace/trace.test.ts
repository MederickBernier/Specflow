import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeGit } from "../git.js";
import { loadSpecTree } from "../load.js";
import type { SpecTree } from "../model.js";
import { NodeFileSystem } from "../node/fs.js";
import { NodeGit } from "../node/git.js";
import { toPosixPath } from "../paths.js";
import { parseTraceLog, readTraceCommits, type TraceCommit } from "./commits.js";
import { trace } from "./trace.js";

describe("parseTraceLog", () => {
  const record = (header: string[], files: string[]) => `\x1e${header.join("\x1f")}\0\n${files.join("\0")}\0`;

  it("parses hash, date, subject, trailers and name-status with renames", () => {
    const output = record(
      ["abc", "2026-01-02T03:04:05+00:00", "feat(auth): two", "Spec-Feature: auth\x1dSpec-Task: T2\x1dSpec-Req: R1, other/R5"],
      ["M", "b c.txt", "R100", "a.txt", "moved.txt"],
    );
    expect(parseTraceLog(output)).toEqual([
      {
        hash: "abc",
        date: "2026-01-02T03:04:05+00:00",
        subject: "feat(auth): two",
        files: [
          { status: "M", path: "b c.txt" },
          { status: "R100", from: "a.txt", path: "moved.txt" },
        ],
        features: ["auth"],
        tasks: ["auth/T2"],
        reqs: ["auth/R1", "other/R5"],
      },
    ]);
  });

  it("drops none, resolves full refs, and ignores bare refs when several features are named", () => {
    const [commit] = parseTraceLog(
      record(["h", "d", "s", "Spec-Feature: a, b\x1dSpec-Task: none\x1dSpec-Req: a/R1, R2, none"], []),
    );
    expect(commit).toMatchObject({ features: ["a", "b"], tasks: [], reqs: ["a/R1"] });
  });

  it("leaves out commits whose trailers reference nothing", () => {
    expect(parseTraceLog(record(["h", "d", "s", "Spec-Feature: none\x1dSpec-Task: none\x1dSpec-Req: none"], ["M", "x"]))).toEqual([]);
    expect(parseTraceLog(record(["h", "d", "s", ""], ["M", "x"]))).toEqual([]);
  });

  it("returns no commits for a repository without commits", async () => {
    const git = new FakeGit(() => ({ exitCode: 128, stderr: "fatal: your current branch 'main' does not have any commits yet\n" }));
    expect(await readTraceCommits(git, "/repo")).toEqual({ ok: true, value: [] });
  });
});

describe("trace on a fixture repo with a rebase", () => {
  let dir = "";
  let tree: SpecTree;
  let commits: TraceCommit[];
  let hashesBeforeRebase: string[] = [];
  let day = 1;

  // Each commit gets its own day, so dates are fixed and ordered.
  function git(...args: string[]): string {
    return gitWithInput(undefined, ...args);
  }

  function gitWithInput(input: string | undefined, ...args: string[]): string {
    const date = `2026-03-${String(day).padStart(2, "0")}T10:00:00Z`;
    return execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      ...(input !== undefined && { input }),
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  }

  function commitWith(file: string, message: string) {
    day++;
    writeFileSync(join(dir, file), `${file} on day ${day}\n`);
    git("add", "--", file);
    gitWithInput(message, "commit", "--quiet", "-F", "-");
  }

  beforeAll(async () => {
    dir = toPosixPath(mkdtempSync(join(tmpdir(), "specflow-trace-")));
    cpSync(fileURLToPath(new URL("../../../../fixtures/repos/clean", import.meta.url)), dir, { recursive: true });
    for (const [key, value] of [["user.name", "Test"], ["user.email", "test@example.com"], ["commit.gpgsign", "false"]]) {
      git("config", key!, value!);
    }


    git("checkout", "--quiet", "-b", "work");
    commitWith("src/auth/login.ts", "feat(accounts): Sign-in endpoint\n\nSpec-Feature: accounts\nSpec-Task: T2\nSpec-Req: R1\n");
    commitWith("README.md", "chore: tidy\n\nNo trailers, but mentions Spec-Req: R1 in the body.\n");
    commitWith("src/auth/lockout.ts", "feat(accounts): Add lockout counter\n\nSpec-Feature: accounts\nSpec-Task: T3\nSpec-Req: R2\n");
    commitWith("src/billing.ts", "feat(billing): Pay endpoint\n\nSpec-Feature: billing\nSpec-Task: T1\nSpec-Req: R1, accounts/R1\n");
    commitWith("src/shared.ts", "refactor: shared helper\n\nSpec-Feature: accounts, billing\nSpec-Task: none\nSpec-Req: R1\n");
    hashesBeforeRebase = git("log", "--format=%H").trim().split("\n");

    // Upstream moves on, and the work branch is rebased onto it: every hash changes.
    git("checkout", "--quiet", "main");
    commitWith("UPSTREAM.md", "docs: upstream change\n");
    git("checkout", "--quiet", "work");
    day++;
    git("rebase", "--quiet", "main");

    const fs = new NodeFileSystem();
    const loaded = await loadSpecTree(fs, dir);
    if (!loaded.ok) throw new Error(loaded.error.message);
    tree = loaded.value;
    const read = await readTraceCommits(new NodeGit({ cwd: dir }), dir);
    if (!read.ok) throw new Error(read.error.message);
    commits = read.value;
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads only commits with spec trailers, newest first, with rebased hashes", () => {
    expect(commits.map((c) => c.subject)).toEqual([
      "feat(billing): Pay endpoint",
      "feat(accounts): Add lockout counter",
      "feat(accounts): Sign-in endpoint",
    ]);
    const current = git("log", "--format=%H").trim().split("\n");
    for (const c of commits) {
      expect(current).toContain(c.hash);
      expect(hashesBeforeRebase).not.toContain(c.hash);
    }
  });

  // task-run/R8
  it("traces a requirement to its tasks and every commit referencing it", () => {
    const result = trace(tree, commits, "accounts/R1");
    if (!result.ok || result.value.kind !== "requirement") throw new Error(JSON.stringify(result));
    const { trace: r1 } = result.value;

    expect(r1).toMatchObject({ feature: "accounts", id: "R1", title: "Sign in with email" });
    expect(r1.tasks).toEqual([{ feature: "accounts", id: "T2", title: "Sign-in endpoint", status: "done" }]);
    expect(r1.commits.map((c) => [c.subject, c.date, c.files])).toEqual([
      ["feat(billing): Pay endpoint", "2026-03-05T10:00:00+00:00", [{ status: "A", path: "src/billing.ts" }]],
      ["feat(accounts): Sign-in endpoint", "2026-03-02T10:00:00+00:00", [{ status: "M", path: "src/auth/login.ts" }]],
    ]);
    expect(r1.commits.every((c) => /^[0-9a-f]{40}$/.test(c.hash))).toBe(true);
  });

  it("traces a task", () => {
    const result = trace(tree, commits, "accounts/T3");
    expect(result.ok && result.value).toMatchObject({
      kind: "task",
      trace: { id: "T3", status: "todo", reqs: ["accounts/R2"], commits: [{ subject: "feat(accounts): Add lockout counter" }] },
    });
  });

  it("traces a whole feature, grouped per requirement and per task", () => {
    const result = trace(tree, commits, "billing");
    if (!result.ok || result.value.kind !== "feature") throw new Error(JSON.stringify(result));
    expect(result.value.trace.requirements.map((r) => [r.id, r.tasks.map((t) => t.id), r.commits.length])).toEqual([["R1", ["T1"], 1]]);
    expect(result.value.trace.tasks.map((t) => [t.id, t.commits.map((c) => c.subject)])).toEqual([["T1", ["feat(billing): Pay endpoint"]]]);
  });

  it("returns no commits for a requirement nothing references yet", () => {
    const result = trace(tree, commits, "accounts/R3");
    expect(result.ok && result.value.kind === "requirement" && result.value.trace.commits).toEqual([]);
  });

  it.each([
    ["nope", "No feature nope"],
    ["accounts/R9", "No requirement or task R9 in feature accounts"],
  ])("fails for %s", (target, message) => {
    expect(trace(tree, commits, target)).toEqual({ ok: false, error: { kind: "not-found", message } });
  });
});
