import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  eventSequenceProblems,
  FakeClock,
  FakeGit,
  type FakeGitResponse,
  FakeProcess,
  FakeSpawner,
  type ProcessScript,
  type RunEvent,
  type SpawnCall,
} from "@specflow/core";
import { describe, expect, it } from "vitest";
import { baseArgs, ClaudeCodeAdapter } from "./adapter.js";
import { installUrl } from "./check.js";

// Contract tests: each recorded stream in fixtures/streams/ maps to exactly
// these events. Recordings ran in /work/toy (after sanitizing).
const cwd = "/work/toy";
const streams = fileURLToPath(new URL("../../../fixtures/streams/", import.meta.url));
const recording = (name: string) => readFileSync(`${streams}claude-code-${name}.jsonl`, "utf8").trimEnd().split("\n");
const input = { cwd, prompt: "Do the task", extraArgs: ["--model", "haiku"] };
const clock = new FakeClock("2026-10-25T12:00:00Z");
const at = clock.now().toISOString();

/** Git where `status` returns `before` on the first call and `after` later. */
function git(after = "", before = ""): FakeGit {
  let statusCalls = 0;
  return new FakeGit(({ args }): FakeGitResponse => {
    if (args[0] === "rev-parse") return "\n";
    if (args[0] === "status") return statusCalls++ === 0 ? before : after;
    return { exitCode: 1, stderr: `unexpected git ${args.join(" ")}` };
  });
}

function spawner(run: (call: SpawnCall) => ProcessScript | FakeProcess, auth = '{"loggedIn":true,"email":"x@y.z"}') {
  return new FakeSpawner((call) => {
    if (call.args[0] === "--version") return { stdout: ["2.1.310 (Claude Code)"] };
    if (call.args[0] === "auth") return { stdout: [auth] };
    return run(call);
  });
}

function adapter(run: (call: SpawnCall) => ProcessScript | FakeProcess, gitStub = git(), killGraceMs = 5_000) {
  const spawn = spawner(run);
  return { spawn, adapter: new ClaudeCodeAdapter({ spawner: spawn, git: gitStub, clock, cwd, platform: "linux", killGraceMs }) };
}

async function collect(events: AsyncIterable<RunEvent>, onEvent?: (event: RunEvent) => void): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const event of events) {
    out.push(event);
    onEvent?.(event);
  }
  return out;
}

const play = (name: string, code: number) => () => ({ stdout: recording(name), exit: { code, signal: null } });

describe("ClaudeCodeAdapter contract", () => {
  // task-run/R4
  it("maps claude-code-success.jsonl", async () => {
    const { adapter: claude, spawn } = adapter(play("success", 0), git("?? hello.js\0"));
    const events = await collect(claude.run(input, new AbortController().signal));
    const summary =
      'I created `hello.js` and changed it to print "Hello, specflow", but I couldn\'t run `node hello.js` because the shell command was blocked with "This command requires approval." Approve the Bash command and I\'ll run it, or run `node hello.js` yourself from the `spike/toy` directory.';

    expect(events).toEqual([
      { kind: "started", runId: "67dbcfb9-8140-42c0-9d13-deb161f5c9b0", harness: "claude-code", at },
      { kind: "tool-call", tool: "Write", summary: "hello.js" },
      { kind: "file-changed", path: "hello.js", change: "added" },
      { kind: "tool-call", tool: "Edit", summary: "hello.js" },
      { kind: "file-changed", path: "hello.js", change: "modified" },
      { kind: "tool-call", tool: "Bash", summary: "node /work/toy/hello.js" },
      { kind: "command", command: "node /work/toy/hello.js" },
      {
        kind: "error",
        message: "Permission denied for Bash (node /work/toy/hello.js): This command requires approval",
        fatal: false,
      },
      { kind: "message", role: "assistant", text: summary },
      { kind: "usage", inputTokens: 6 + 6050 + 90380, outputTokens: 758, costUsd: 0.0026288, durationMs: 7276 },
      { kind: "finished", ok: true, summary },
    ]);
    expect(eventSequenceProblems(events)).toEqual([]);
    expect(spawn.calls.at(-1)).toEqual({
      command: "claude",
      args: [...baseArgs, "--model", "haiku"],
      cwd,
      stdin: "Do the task",
    });
  });

  // task-run/R4: files changed through Bash come from git status after exit.
  it("maps claude-code-bash-write.jsonl, reporting the Bash-written file from git status", async () => {
    const { adapter: claude } = adapter(play("bash-write", 0), git("?? hello.js\0"));
    const events = await collect(claude.run(input, new AbortController().signal));
    const summary = 'I created `hello.js` in the toy directory and `node hello.js` printed "Hello, world".';
    const command = "printf 'console.log(\"Hello, world\");\\n' > hello.js && node hello.js";

    expect(events).toEqual([
      { kind: "started", runId: "355619da-db3c-424d-a855-b0e079f3ba21", harness: "claude-code", at },
      { kind: "tool-call", tool: "Bash", summary: command },
      { kind: "command", command },
      { kind: "message", role: "assistant", text: summary },
      { kind: "usage", inputTokens: 4 + 4804 + 58884, outputTokens: 209, costUsd: 0.0017842399999999999, durationMs: 3697 },
      { kind: "file-changed", path: "hello.js", change: "added" },
      { kind: "finished", ok: true, summary },
    ]);
  });

  // task-run/R4: the run ends with exactly one finished carrying failure.
  it("maps claude-code-max-turns.jsonl to a failed run", async () => {
    const { adapter: claude } = adapter(play("max-turns", 1));
    const events = await collect(claude.run(input, new AbortController().signal));

    expect(events.map((e) => e.kind)).toEqual(["started", "tool-call", "command", "error", "usage", "error", "finished"]);
    expect(events[3]).toEqual({
      kind: "error",
      message: expect.stringMatching(/^Permission denied for Bash \(for n in a b c; .*\): A variable in this command can't be checked before it runs$/),
      fatal: false,
    });
    expect(events.slice(4)).toEqual([
      { kind: "usage", inputTokens: 2 + 5210 + 26531, outputTokens: 202, costUsd: 0.0015413100000000002, durationMs: 1733 },
      { kind: "error", message: "Reached maximum number of turns (1)", fatal: true },
      { kind: "finished", ok: false },
    ]);
  });

  // task-run/R5: SIGTERM, and a cancelled finished event although Claude Code prints no result.
  it("maps claude-code-cancelled.jsonl after an abort", async () => {
    const process = new FakeProcess();
    const { adapter: claude } = adapter(() => process);
    const controller = new AbortController();
    const lines = recording("cancelled");
    process.writeStdout(...lines.slice(0, 3));

    const events = await collect(claude.run(input, controller.signal), (event) => {
      if (event.kind === "command") {
        process.writeStdout(...lines.slice(3));
        controller.abort();
      }
    });

    expect(process.kills).toEqual(["SIGTERM"]);
    expect(events).toEqual([
      { kind: "started", runId: "524d20ba-29f7-4f6d-830b-836dfb68cba6", harness: "claude-code", at },
      { kind: "tool-call", tool: "Bash", summary: "sleep 60" },
      { kind: "command", command: "sleep 60" },
      { kind: "finished", ok: false, cancelled: true },
    ]);
  });
});

describe("ClaudeCodeAdapter cancelling", () => {
  // task-run/R5: SIGKILL when SIGTERM is ignored.
  it("escalates to SIGKILL after the grace period", async () => {
    class Stubborn extends FakeProcess {
      override kill(signal: "SIGTERM" | "SIGKILL"): void {
        this.kills.push(signal);
        if (signal === "SIGKILL") this.finish({ code: null, signal });
      }
    }
    const process = new Stubborn();
    process.writeStdout(recording("cancelled")[0]!);
    const { adapter: claude } = adapter(() => process, git(), 20);
    const controller = new AbortController();
    const events = await collect(claude.run(input, controller.signal), () => controller.abort());
    expect(process.kills).toEqual(["SIGTERM", "SIGKILL"]);
    expect(events.at(-1)).toEqual({ kind: "finished", ok: false, cancelled: true });
  });

  it("does not start the harness when already aborted", async () => {
    const { adapter: claude, spawn } = adapter(play("success", 0));
    const controller = new AbortController();
    controller.abort();
    const events = await collect(claude.run(input, controller.signal));
    expect(events.map((e) => e.kind)).toEqual(["started", "finished"]);
    expect(events.at(-1)).toEqual({ kind: "finished", ok: false, cancelled: true });
    expect(spawn.calls).toEqual([]);
  });

  it("stops the process when the caller stops reading", async () => {
    const process = new FakeProcess();
    process.writeStdout(...recording("cancelled").slice(0, 3));
    const { adapter: claude } = adapter(() => process);
    for await (const _event of claude.run(input, new AbortController().signal)) break;
    expect(process.kills).toEqual(["SIGTERM"]);
  });
});

describe("ClaudeCodeAdapter robustness", () => {
  it("ignores non-JSON lines and unknown event types", async () => {
    const lines = recording("bash-write");
    const { adapter: claude } = adapter(() => ({
      stdout: [lines[0]!, "not json", '{"type":"future_event","x":1}', ...lines.slice(1)],
      exit: { code: 0, signal: null },
    }));
    const events = await collect(claude.run(input, new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ kind: "finished", ok: true });
    expect(eventSequenceProblems(events)).toEqual([]);
  });

  it("fails a run that exits without a result, quoting stderr", async () => {
    const { adapter: claude } = adapter(() => ({
      stdout: [recording("success")[0]!],
      stderr: ["Error: API overloaded"],
      exit: { code: 1, signal: null },
    }));
    const events = await collect(claude.run(input, new AbortController().signal));
    expect(events.slice(-2)).toEqual([
      { kind: "error", message: "claude exited with code 1 without a result:\nError: API overloaded", fatal: true },
      { kind: "finished", ok: false },
    ]);
  });

  it("reports a missing binary as a failed run", async () => {
    const { adapter: claude } = adapter(() => ({ exit: { code: null, signal: null, error: { code: "ENOENT", message: "spawn claude ENOENT" } } }));
    const events = await collect(claude.run(input, new AbortController().signal));
    expect(events).toEqual([
      { kind: "started", runId: `claude-${clock.now().getTime()}`, harness: "claude-code", at },
      { kind: "error", message: "Claude Code (claude) was not found on PATH", fatal: true },
      { kind: "finished", ok: false },
    ]);
  });

  it("does not report files that were already changed before the run", async () => {
    const { adapter: claude } = adapter(play("bash-write", 0), git(" M notes.txt\0?? hello.js\0", " M notes.txt\0"));
    const events = await collect(claude.run(input, new AbortController().signal));
    expect(events.filter((e) => e.kind === "file-changed")).toEqual([{ kind: "file-changed", path: "hello.js", change: "added" }]);
  });

  it("maps deletions and works outside a git repo", async () => {
    const deleted = adapter(play("bash-write", 0), git(" D old.js\0"));
    const events = await collect(deleted.adapter.run(input, new AbortController().signal));
    expect(events.filter((e) => e.kind === "file-changed")).toEqual([{ kind: "file-changed", path: "old.js", change: "deleted" }]);

    const noRepo = adapter(play("bash-write", 0), new FakeGit(() => ({ exitCode: 128, stderr: "fatal: not a git repository" })));
    const plain = await collect(noRepo.adapter.run(input, new AbortController().signal));
    expect(plain.filter((e) => e.kind === "file-changed")).toEqual([]);
    expect(plain.at(-1)).toMatchObject({ kind: "finished", ok: true });
  });
});

describe("ClaudeCodeAdapter.check", () => {
  function check(options: { version?: ProcessScript; auth?: string; platform?: string }) {
    const spawn = new FakeSpawner((call) => {
      if (call.args[0] === "--version") return options.version ?? { stdout: ["2.1.310 (Claude Code)"] };
      return { stdout: [options.auth ?? '{"loggedIn":true,"email":"someone@example.com","orgName":"Org"}'] };
    });
    return new ClaudeCodeAdapter({ spawner: spawn, git: git(), clock, cwd, platform: options.platform ?? "linux" }).check();
  }

  it("reports the version when installed and signed in, without keeping account details", async () => {
    const result = await check({});
    expect(result).toEqual({ ok: true, value: { version: "2.1.310", warnings: [] } });
    expect(JSON.stringify(result)).not.toContain("someone@example.com");
  });

  // task-run/R4: missing binary fails clearly, with install docs.
  it("reports a missing binary clearly", async () => {
    expect(await check({ version: { exit: { code: null, signal: null, error: { code: "ENOENT", message: "spawn claude ENOENT" } } } })).toEqual({
      ok: false,
      error: { kind: "not-installed", message: "Claude Code (claude) was not found on PATH.", installUrl },
    });
  });

  it("explains claude.cmd on Windows", async () => {
    const result = await check({ platform: "win32", version: { exit: { code: null, signal: null, error: { code: "ENOENT", message: "x" } } } });
    expect(!result.ok && result.error.message).toContain("claude.cmd");
  });

  it("reports a signed-out harness", async () => {
    expect(await check({ auth: '{"loggedIn":false}' })).toMatchObject({ ok: false, error: { kind: "not-authenticated", installUrl } });
  });

  it.each([
    ["2.0.9 (Claude Code)", "outside the tested range"],
    ["3.0.0 (Claude Code)", "outside the tested range"],
    ["weird", "Could not read the Claude Code version"],
  ])("warns but does not fail for version %j", async (stdout, warning) => {
    const result = await check({ version: { stdout: [stdout] } });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.warnings).toEqual([expect.stringContaining(warning)]);
  });

  it("warns when sign-in cannot be determined", async () => {
    const result = await check({ auth: "unknown command auth" });
    expect(result.ok && result.value.warnings).toEqual(["Could not tell whether Claude Code is signed in"]);
  });
});
