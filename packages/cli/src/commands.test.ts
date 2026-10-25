import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AdapterRegistry,
  err,
  FakeClock,
  type HarnessAdapter,
  ok,
  ReplayAdapter,
  type RunEvent,
  toPosixPath,
} from "@specflow/core";
import { NodeFileSystem, NodeGit } from "@specflow/core/node";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "./program.js";

const fixtures = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const fs = new NodeFileSystem();
let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

/** A copy of the clean fixture repo with a local identity, in `commit.mode`. */
function repo(mode: "staged" | "auto" = "staged") {
  dir = toPosixPath(mkdtempSync(join(tmpdir(), "specflow-cli-")));
  cpSync(join(fixtures, "repos/clean"), dir, { recursive: true });
  for (const [key, value] of [["user.name", "Test"], ["user.email", "test@example.com"], ["commit.gpgsign", "false"]]) {
    git("config", key!, value!);
  }
  if (mode === "auto") {
    const config = join(dir, ".specs/config.yml");
    writeFileSync(config, readFileSync(config, "utf8").replace("mode: staged", "mode: auto"));
    git("commit", "--quiet", "-am", "chore: auto mode");
  }
  return dir;
}

const started: RunEvent = { kind: "started", runId: "run-1", harness: "test", at: "2026-01-01T00:00:00Z" };

/** Writes src/auth/lockout.ts like a real agent would, and reports it. */
function writer(): HarnessAdapter {
  return {
    name: "test",
    check: async () => ok({ version: "1.0.0", warnings: ["untested version 1.0.0"] }),
    run: async function* () {
      yield started;
      yield { kind: "message", role: "assistant", text: "Adding the lockout counter." };
      yield { kind: "tool-call", tool: "Write", summary: "src/auth/lockout.ts" };
      writeFileSync(join(dir, "src/auth/lockout.ts"), "export const attempts = 5;\n");
      yield { kind: "file-changed", path: "src/auth/lockout.ts", change: "added" };
      yield { kind: "command", command: "pnpm test", exitCode: 0 };
      yield { kind: "usage", inputTokens: 12400, outputTokens: 1830, costUsd: 0.0712, durationMs: 48250 };
      yield { kind: "finished", ok: true, summary: "Added the lockout counter." };
    },
  };
}

/** Waits until cancelled. */
function hanging(): HarnessAdapter {
  return {
    name: "hang",
    check: async () => ok({ version: "1", warnings: [] }),
    run: async function* (_input, signal) {
      yield { ...started, harness: "hang" };
      await new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve())));
      yield { kind: "finished", ok: false };
    },
  };
}

const missing: HarnessAdapter = {
  name: "missing",
  check: async () => err({ kind: "not-installed", message: "missing was not found on PATH.", installUrl: "https://example.com/install" }),
  run: async function* () {},
};

async function specflow(...argv: string[]) {
  let stdout = "";
  let stderr = "";
  let interrupt: (() => void) | undefined;
  const registry = new AdapterRegistry([
    writer(),
    hanging(),
    missing,
    new ReplayAdapter({ name: "fails", fs, file: toPosixPath(join(fixtures, "events/failure.jsonl")) }),
  ]);
  const code = await run(argv, {
    cwd: `${dir}/src`,
    fs,
    git: new NodeGit({ cwd: dir }),
    registry,
    clock: new FakeClock(),
    stdout: (text) => {
      stdout += text;
      // The hanging harness is cancelled as soon as it starts, like a user pressing Ctrl+C.
      if (text.startsWith("Running accounts/T3 with hang")) interrupt?.();
    },
    stderr: (text) => (stderr += text),
    onInterrupt: (handler) => {
      interrupt = handler;
      return () => (interrupt = undefined);
    },
  });
  const clean = (text: string) => text.replaceAll(dir, "<root>");
  return { code, stdout: clean(stdout), stderr: clean(stderr) };
}

const tasksMd = () => readFileSync(join(dir, ".specs/accounts/tasks.md"), "utf8");
const originalTasks = () => readFileSync(join(fixtures, "specs/clean/.specs/accounts/tasks.md"), "utf8");

describe("specflow run", () => {
  // task-run/R4 end to end: events stream, staged result with trailers, task done.
  it("runs a task, streams its events and stages the result", async () => {
    repo();
    const result = await specflow("run", "accounts/T3", "--harness", "test");

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("specflow: warning: untested version 1.0.0\n");
    expect(result.stdout).toMatchSnapshot();
    expect(git("diff", "--cached", "--name-only").trim().split("\n")).toEqual([".specs/accounts/tasks.md", "src/auth/lockout.ts"]);
    expect(tasksMd()).toBe(originalTasks().replace("## T3: Add lockout counter [R2]\nstatus: todo", "## T3: Add lockout counter [R2]\nstatus: done"));
    expect(readFileSync(join(dir, ".git/SPECFLOW_MSG"), "utf8")).toBe(
      "feat(accounts): Add lockout counter\n\nAdded the lockout counter.\n\nSpec-Feature: accounts\nSpec-Task: T3\nSpec-Req: R2\n",
    );
  });

  // task-run/R4 + R8: auto mode commits, and trace finds the commit from its trailers.
  it("commits in auto mode, and trace finds the commit", async () => {
    repo("auto");
    const result = await specflow("run", "accounts/T3", "--harness", "test");
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Committed [0-9a-f]{7} with 2 files and marked the task done\.\n$/);
    expect(git("status", "--porcelain")).toBe("");

    const traced = await specflow("trace", "accounts/R2");
    expect(traced.code).toBe(0);
    const hash = git("rev-parse", "--short=7", "HEAD").trim();
    expect(traced.stdout).toMatch(
      new RegExp(
        `^accounts/R2: Lock out after failed attempts\n\nTasks\n  accounts/T3  done  Add lockout counter\n\nCommits\n  ${hash}  \\d{4}-\\d{2}-\\d{2}  feat\\(accounts\\): Add lockout counter\n      M \\.specs/accounts/tasks\\.md\n      A src/auth/lockout\\.ts\n$`,
      ),
    );

    const json = JSON.parse((await specflow("trace", "accounts/R2", "--json")).stdout);
    expect(json).toMatchObject({ schema: "specflow.trace/v1", kind: "requirement", trace: { id: "R2", commits: [{ subject: "feat(accounts): Add lockout counter" }] } });
  });

  it("restores the task status and records nothing when the run fails", async () => {
    repo();
    const result = await specflow("run", "accounts/T3", "--harness", "fails");
    expect(result.code).toBe(1);
    expect(result.stdout).toMatchSnapshot();
    expect(tasksMd()).toBe(originalTasks());
    expect(git("diff", "--cached", "--name-only")).toBe("");
  });

  // task-run/R5 from the CLI: Ctrl+C cancels, exit 130, status restored.
  it("cancels on Ctrl+C", async () => {
    repo();
    const result = await specflow("run", "accounts/T3", "--harness", "hang");
    expect(result.code).toBe(130);
    expect(result.stderr).toContain("Cancelling...");
    expect(result.stdout).toContain("\nCancelled.\n");
    expect(tasksMd()).toBe(originalTasks());
  });

  // task-run/R10 from the CLI.
  it("refuses a dirty tree unless --allow-dirty is passed", async () => {
    repo();
    writeFileSync(join(dir, "src/auth/login.ts"), "// mine\n");
    const refused = await specflow("run", "accounts/T3", "--harness", "test");
    expect(refused).toEqual({
      code: 1,
      stdout: "",
      stderr: "specflow: Uncommitted changes outside .specs/:\n  src/auth/login.ts\nCommit or stash them, or pass --allow-dirty.\n",
    });
    expect(tasksMd()).toBe(originalTasks());

    const allowed = await specflow("run", "accounts/T3", "--harness", "test", "--allow-dirty");
    expect(allowed.code).toBe(0);
    expect(git("diff", "--cached", "--name-only")).not.toContain("src/auth/login.ts");
  });

  it("explains a missing harness with its install link", async () => {
    repo();
    expect(await specflow("run", "accounts/T3", "--harness", "missing")).toEqual({
      code: 1,
      stdout: "",
      stderr: "specflow: missing was not found on PATH.\nSee https://example.com/install\n",
    });
  });

  it.each([
    [["run", "accounts"], 2, 'Expected <feature>/<task>, such as auth/T3, not "accounts"'],
    [["run", "accounts/T9", "--harness", "test"], 1, "No task accounts/T9"],
    [["run", "accounts/T3", "--harness", "aider"], 1, 'Unknown harness "aider". Registered: fails, hang, missing, test'],
  ])("rejects %j", async (argv, code, message) => {
    repo();
    expect(await specflow(...argv)).toEqual({ code, stdout: "", stderr: `specflow: ${message}\n` });
  });

  it("prints one versioned JSON object per line with --json", async () => {
    repo();
    const result = await specflow("run", "accounts/T3", "--harness", "test", "--json");
    const lines = result.stdout.trimEnd().split("\n").map((line) => JSON.parse(line));
    expect(lines.every((line) => line.schema === "specflow.run/v1")).toBe(true);
    expect(lines[0]).toEqual({ schema: "specflow.run/v1", warning: "untested version 1.0.0" });
    expect(lines.slice(1, -1).map((line) => line.event.kind)).toEqual([
      "started",
      "message",
      "tool-call",
      "file-changed",
      "command",
      "usage",
      "finished",
    ]);
    expect(lines.at(-1)).toEqual({
      schema: "specflow.run/v1",
      result: {
        ok: true,
        cancelled: false,
        files: ["src/auth/lockout.ts"],
        recording: {
          mode: "staged",
          message: expect.stringContaining("Spec-Task: T3"),
          messageFile: "<root>/.git/SPECFLOW_MSG",
          files: ["src/auth/lockout.ts", ".specs/accounts/tasks.md"],
        },
      },
    });
  });
});

describe("specflow trace", () => {
  it("shows a requirement with no commits yet", async () => {
    repo();
    const result = await specflow("trace", "accounts/R1");
    expect(result).toEqual({
      code: 0,
      stdout: "accounts/R1: Sign in with email\n\nTasks\n  accounts/T2  done  Sign-in endpoint\n\nCommits\n  no commits\n",
      stderr: "",
    });
  });

  it("traces a whole feature", async () => {
    repo();
    const result = await specflow("trace", "billing");
    expect(result.stdout).toBe("billing\n\nR1: Pay for an order\n  tasks: billing/T1 (todo)\n  no commits\n");
  });

  it("exits 1 for an unknown target", async () => {
    repo();
    expect(await specflow("trace", "accounts/R9")).toEqual({
      code: 1,
      stdout: "",
      stderr: "specflow: No requirement or task R9 in feature accounts\n",
    });
  });
});

describe("specflow harness check", () => {
  it("reports a ready harness with warnings", async () => {
    repo();
    expect(await specflow("harness", "check", "--harness", "test")).toEqual({
      code: 0,
      stdout: "test 1.0.0: ready\n  warning: untested version 1.0.0\n",
      stderr: "",
    });
  });

  it("reports a missing harness with its install link", async () => {
    repo();
    expect(await specflow("harness", "check", "--harness", "missing")).toEqual({
      code: 1,
      stdout: "",
      stderr: "specflow: missing: missing was not found on PATH.\nSee https://example.com/install\n",
    });
    const json = JSON.parse((await specflow("harness", "check", "--harness", "missing", "--json")).stdout);
    expect(json).toEqual({
      schema: "specflow.harness/v1",
      harness: "missing",
      ok: false,
      error: { kind: "not-installed", message: "missing was not found on PATH.", installUrl: "https://example.com/install" },
    });
  });

  it("uses harness.default from config, also outside a spec repo", async () => {
    repo();
    const result = await specflow("harness", "check");
    expect(result.stderr).toBe('specflow: Unknown harness "claude-code". Registered: fails, hang, missing, test\n');
    rmSync(join(dir, ".specs"), { recursive: true });
    expect(existsSync(join(dir, ".specs"))).toBe(false);
    expect((await specflow("harness", "check")).stderr).toContain('Unknown harness "claude-code"');
  });
});
