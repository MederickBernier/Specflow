import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { FakeClock } from "../clock.js";
import { FakeGit } from "../git.js";
import { loadSpecTree } from "../load.js";
import type { SpecTree } from "../model.js";
import { NodeFileSystem } from "../node/fs.js";
import { NodeGit } from "../node/git.js";
import { toPosixPath } from "../paths.js";
import { ok } from "../result.js";
import { AdapterRegistry, type HarnessAdapter } from "./adapter.js";
import { eventSequenceProblems, type RunEvent } from "./events.js";
import { buildTaskPrompt } from "./prompt.js";
import { parseEventStream, ReplayAdapter } from "./replay-adapter.js";
import { type RunnerDeps, type RunRequest, startRun } from "./runner.js";

const fs = new NodeFileSystem();
const cleanRoot = toPosixPath(fileURLToPath(new URL("../../../../fixtures/repos/clean", import.meta.url)));
const eventsDir = toPosixPath(fileURLToPath(new URL("../../../../fixtures/events", import.meta.url)));
const request: RunRequest = { feature: "accounts", task: "T3" };

const cleanGit = () => new FakeGit(() => "");
const started: RunEvent = { kind: "started", runId: "r1", harness: "test", at: "2026-01-01T00:00:00Z" };
const message = (text: string): RunEvent => ({ kind: "message", role: "assistant", text });

async function cleanTree(): Promise<SpecTree> {
  const tree = await loadSpecTree(fs, cleanRoot);
  if (!tree.ok) throw new Error(tree.error.message);
  return tree.value;
}

function deps(adapters: HarnessAdapter[], overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  return { fs, git: cleanGit(), registry: new AdapterRegistry(adapters), clock: new FakeClock(), ...overrides };
}

/** An adapter that runs `body` and reports `name`. */
function adapter(name: string, body: (signal: AbortSignal) => AsyncIterable<RunEvent>): HarnessAdapter {
  return { name, check: async () => ok({ version: "1", warnings: [] }), run: (_input, signal) => body(signal) };
}

function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true })));
}

async function collect(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

async function run(d: RunnerDeps, tree: SpecTree, req: RunRequest = request, signal = new AbortController().signal) {
  const handle = await startRun(d, tree, req, signal);
  if (!handle.ok) throw new Error(handle.error.message);
  return handle.value;
}

const tree = await cleanTree();
const configured: SpecTree = { ...tree, config: { ...tree.config, harness: { default: "replay", adapters: { replay: { extraArgs: ["--fast"] } } } } };

describe("startRun", () => {
  it("runs the task through the configured adapter with the built prompt", async () => {
    const replay = new ReplayAdapter({ fs, file: `${eventsDir}/success.jsonl` });
    const handle = await run(deps([replay]), configured);
    const expected = parseEventStream(await fs.readFile(`${eventsDir}/success.jsonl`));
    if (!expected.ok) throw new Error(expected.error);

    expect(await collect(handle.events)).toEqual(expected.value);
    const prompt = await buildTaskPrompt(fs, configured, { feature: "accounts", task: "T3" });
    expect(handle).toMatchObject({ harness: "replay", prompt: prompt.ok && prompt.value, warnings: [] });
    expect(replay.inputs).toEqual([{ cwd: cleanRoot, prompt: handle.prompt, extraArgs: ["--fast"] }]);
  });

  it("uses the requested harness over config", async () => {
    const other = new ReplayAdapter({ name: "other", events: [started, { kind: "finished", ok: true }] });
    const handle = await run(deps([new ReplayAdapter({ events: [] }), other]), configured, { ...request, harness: "other" });
    expect(handle.harness).toBe("other");
  });

  it("does not start the harness until events are read", async () => {
    const replay = new ReplayAdapter({ events: [started, { kind: "finished", ok: true }] });
    await run(deps([replay]), configured);
    expect(replay.inputs).toEqual([]);
  });

  // task-run/R10
  it("refuses a dirty tree, listing the files, without starting the harness", async () => {
    const git = new FakeGit(() => " M src/auth/login.ts\0?? notes.txt\0");
    const replay = new ReplayAdapter({ events: [] });
    const result = await startRun(deps([replay], { git }), configured, request, new AbortController().signal);
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "dirty-tree",
        files: ["src/auth/login.ts", "notes.txt"],
        message:
          "Uncommitted changes outside .specs/:\n  src/auth/login.ts\n  notes.txt\nCommit or stash them, or pass --allow-dirty.",
      },
    });
    expect(git.calls).toEqual([
      {
        args: ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".", ":(exclude).specs"],
        cwd: cleanRoot,
      },
    ]);
    expect(replay.inputs).toEqual([]);
  });

  // task-run/R10
  it("runs on a dirty tree with allowDirty, without asking git", async () => {
    const git = new FakeGit(() => " M src/auth/login.ts\0");
    const replay = new ReplayAdapter({ events: [started, { kind: "finished", ok: true }] });
    const handle = await run(deps([replay], { git }), configured, { ...request, allowDirty: true });
    expect((await collect(handle.events)).map((e) => e.kind)).toEqual(["started", "finished"]);
    expect(git.calls).toEqual([]);
  });

  it("reports git failures", async () => {
    const git = new FakeGit(() => ({ exitCode: 128, stderr: "fatal: not a git repository" }));
    const result = await startRun(deps([new ReplayAdapter({ events: [] })], { git }), configured, request, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { kind: "git-failed" } });
  });

  it.each([
    [{ feature: "accounts", task: "T9" }, "unknown-task"],
    [{ ...request, harness: "aider" }, "unknown-adapter"],
  ])("fails before starting for %j", async (req, kind) => {
    const result = await startRun(deps([new ReplayAdapter({ events: [] })]), configured, req, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { kind } });
  });

  it("fails before starting when the harness check fails", async () => {
    const missing: HarnessAdapter = {
      name: "replay",
      check: async () => ({ ok: false, error: { kind: "not-installed", message: "claude not found", installUrl: "https://example.com" } }),
      run: async function* () {},
    };
    const result = await startRun(deps([missing]), configured, request, new AbortController().signal);
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "harness-unavailable",
        harness: "replay",
        check: { kind: "not-installed", message: "claude not found", installUrl: "https://example.com" },
        message: "claude not found",
      },
    });
  });

  it("passes harness check warnings through", async () => {
    const old: HarnessAdapter = {
      name: "replay",
      check: async () => ok({ version: "1.0", warnings: ["untested version 1.0"] }),
      run: async function* () {},
    };
    expect((await run(deps([old]), configured)).warnings).toEqual(["untested version 1.0"]);
  });
});

describe("cancelling", () => {
  // task-run/R5
  it("ends with a cancelled finished event when aborted mid-run", async () => {
    const controller = new AbortController();
    const replay = new ReplayAdapter({ fs, file: `${eventsDir}/success.jsonl` });
    const handle = await run(deps([replay]), configured, request, controller.signal);
    const events: RunEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
      if (event.kind === "tool-call") controller.abort();
    }
    expect(events.at(-1)).toEqual({ kind: "finished", ok: false, cancelled: true });
    expect(eventSequenceProblems(events)).toEqual([]);
  });

  // task-run/R5: a harness that ignores the abort is cut off after the grace period.
  it("ends the run itself when the harness does not stop in time", async () => {
    const controller = new AbortController();
    const stuck = adapter("replay", async function* () {
      yield started;
      await new Promise(() => {});
    });
    const handle = await run(deps([stuck], { cancelGraceMs: 30 }), configured, request, controller.signal);
    const events: RunEvent[] = [];
    const before = Date.now();
    for await (const event of handle.events) {
      events.push(event);
      if (event.kind === "started") controller.abort();
    }
    expect(Date.now() - before).toBeLessThan(2_000);
    expect(events).toEqual([
      started,
      { kind: "error", message: "replay did not stop within 0.03 s of being cancelled", fatal: false },
      { kind: "finished", ok: false, cancelled: true },
    ]);
  });

  it("marks a failed finish after abort as cancelled", async () => {
    const controller = new AbortController();
    const quits = adapter("replay", async function* (signal) {
      yield started;
      await aborted(signal);
      yield { kind: "finished", ok: false };
    });
    const handle = await run(deps([quits]), configured, request, controller.signal);
    const events: RunEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
      controller.abort();
    }
    expect(events.at(-1)).toEqual({ kind: "finished", ok: false, cancelled: true });
  });

  it("treats an adapter that throws after abort as cancelled", async () => {
    const controller = new AbortController();
    const throws = adapter("replay", async function* (signal) {
      yield started;
      await aborted(signal);
      throw new Error("killed");
    });
    const handle = await run(deps([throws]), configured, request, controller.signal);
    const events: RunEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
      controller.abort();
    }
    expect(events).toEqual([started, { kind: "finished", ok: false, cancelled: true }]);
  });
});

describe("event rules", () => {
  async function eventsOf(body: (signal: AbortSignal) => AsyncIterable<RunEvent>) {
    return collect((await run(deps([adapter("replay", body)]), configured)).events);
  }

  it("adds a missing started event", async () => {
    const events = await eventsOf(async function* () {
      yield message("hi");
      yield { kind: "finished", ok: true };
    });
    expect(events).toEqual([
      { kind: "started", runId: `run-${new FakeClock().now().getTime()}`, harness: "replay", at: "2026-01-01T00:00:00.000Z" },
      message("hi"),
      { kind: "finished", ok: true },
    ]);
  });

  it("drops extra started events and everything after finished", async () => {
    const events = await eventsOf(async function* () {
      yield started;
      yield { ...started, runId: "r2" };
      yield message("one");
      yield { kind: "finished", ok: true };
      yield message("late");
      yield { kind: "finished", ok: false };
    });
    expect(events).toEqual([started, message("one"), { kind: "finished", ok: true }]);
  });

  it("fails a run that ends without finished", async () => {
    const events = await eventsOf(async function* () {
      yield started;
      yield message("bye");
    });
    expect(events).toEqual([
      started,
      message("bye"),
      { kind: "error", message: "replay ended without reporting a result", fatal: true },
      { kind: "finished", ok: false },
    ]);
  });

  it("fails a run whose adapter throws", async () => {
    const events = await eventsOf(async function* () {
      yield started;
      throw new Error("parse error");
    });
    expect(events).toEqual([
      started,
      { kind: "error", message: "Harness failed: parse error", fatal: true },
      { kind: "finished", ok: false },
    ]);
  });

  it("stops the adapter when the caller stops reading", async () => {
    let stopped = false;
    const handle = await run(
      deps([
        adapter("replay", async function* () {
          try {
            yield started;
            yield message("more");
          } finally {
            stopped = true;
          }
        }),
      ]),
      configured,
    );
    for await (const _event of handle.events) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stopped).toBe(true);
  });
});

describe("dirty tree check against real git", () => {
  const dir = toPosixPath(mkdtempSync(join(tmpdir(), "specflow-runner-")));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(cleanRoot, dir, { recursive: true });

  async function attempt() {
    const local = await loadSpecTree(fs, dir);
    if (!local.ok) throw new Error(local.error.message);
    const replay = new ReplayAdapter({ events: [started, { kind: "finished", ok: true }] });
    return startRun(deps([replay], { git: new NodeGit({ cwd: dir }) }), { ...local.value, config: { ...local.value.config, harness: { default: "replay", adapters: {} } } }, request, new AbortController().signal);
  }

  it("ignores changes under .specs/ and reports the rest", async () => {
    expect((await attempt()).ok).toBe(true);

    writeFileSync(join(dir, ".specs/accounts/tasks.md"), "## T3: Add lockout counter [R2]\nstatus: doing\n");
    writeFileSync(join(dir, ".specs/scratch.md"), "notes\n");
    expect((await attempt()).ok).toBe(true);

    writeFileSync(join(dir, "src/auth/login.ts"), "// changed\n");
    writeFileSync(join(dir, "src/auth/new file.ts"), "");
    const result = await attempt();
    expect(result).toMatchObject({ ok: false, error: { kind: "dirty-tree", files: ["src/auth/login.ts", "src/auth/new file.ts"] } });
  });
});
