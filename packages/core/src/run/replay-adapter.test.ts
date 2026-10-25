import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FakeClock } from "../clock.js";
import { MemoryFileSystem } from "../fs.js";
import { NodeFileSystem } from "../node/fs.js";
import { toPosixPath } from "../paths.js";
import { eventSequenceProblems, type RunEvent } from "./events.js";
import { parseEventStream, ReplayAdapter } from "./replay-adapter.js";

const input = { cwd: "/repo", prompt: "Do T2", extraArgs: [] };
const eventsDir = toPosixPath(fileURLToPath(new URL("../../../../fixtures/events", import.meta.url)));

const started: RunEvent = { kind: "started", runId: "r1", harness: "replay", at: "2026-01-01T00:00:00Z" };
const message = (text: string): RunEvent => ({ kind: "message", role: "assistant", text });
const finished: RunEvent = { kind: "finished", ok: true };
const recorded = [started, message("one"), message("two"), finished];

async function collect(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const jsonl = (events: RunEvent[]) => events.map((e) => JSON.stringify(e)).join("\n");

describe("parseEventStream", () => {
  it("parses one event per line, skipping blank lines and accepting CRLF", () => {
    expect(parseEventStream(`${JSON.stringify(started)}\r\n\r\n${JSON.stringify(finished)}\r\n`)).toEqual({
      ok: true,
      value: [started, finished],
    });
  });

  it("names the line of invalid JSON", () => {
    const result = parseEventStream(`${JSON.stringify(started)}\n{not json\n`);
    expect(!result.ok && result.error).toMatch(/^line 2: invalid JSON: /);
  });

  it("names the line of an invalid event", () => {
    const result = parseEventStream(`${JSON.stringify(started)}\n\n{"kind":"thinking"}\n`);
    expect(!result.ok && result.error).toMatch(/^line 3: Invalid run event: /);
  });
});

describe("ReplayAdapter", () => {
  // task-run/R9: emits the recorded events in order.
  it("replays given events in order", async () => {
    const adapter = new ReplayAdapter({ events: recorded });
    expect(await collect(adapter.run(input, new AbortController().signal))).toEqual(recorded);
  });

  it.each(["success", "failure"])("replays fixtures/events/%s.jsonl in order, as a valid sequence", async (name) => {
    const fs = new NodeFileSystem();
    const file = `${eventsDir}/${name}.jsonl`;
    const expected = parseEventStream(await fs.readFile(file));
    if (!expected.ok) throw new Error(expected.error);

    const events = await collect(new ReplayAdapter({ fs, file }).run(input, new AbortController().signal));
    expect(events).toEqual(expected.value);
    expect(eventSequenceProblems(events)).toEqual([]);
    expect(events.at(-1)).toMatchObject({ kind: "finished", ok: name === "success" });
  });

  it("reads the file through the injected FileSystem", async () => {
    const fs = new MemoryFileSystem({ "/streams/run.jsonl": jsonl(recorded) });
    const adapter = new ReplayAdapter({ fs, file: "/streams/run.jsonl" });
    expect(await collect(adapter.run(input, new AbortController().signal))).toEqual(recorded);
  });

  it("records each run's input", async () => {
    const adapter = new ReplayAdapter({ events: recorded });
    await collect(adapter.run(input, new AbortController().signal));
    expect(adapter.inputs).toEqual([input]);
  });

  it("waits between events, not before the first", async () => {
    const waits: number[] = [];
    const adapter = new ReplayAdapter({ events: recorded, delayMs: 25, sleep: async (ms) => void waits.push(ms) });
    await collect(adapter.run(input, new AbortController().signal));
    expect(waits).toEqual([25, 25, 25]);
  });

  it("uses a real timer by default", async () => {
    const adapter = new ReplayAdapter({ events: [started, finished], delayMs: 20 });
    const before = Date.now();
    await collect(adapter.run(input, new AbortController().signal));
    expect(Date.now() - before).toBeGreaterThanOrEqual(15);
  });

  it("stops with a cancelled finished event when aborted", async () => {
    const controller = new AbortController();
    const adapter = new ReplayAdapter({ events: recorded });
    const events: RunEvent[] = [];
    for await (const event of adapter.run(input, controller.signal)) {
      events.push(event);
      if (event.kind === "message") controller.abort();
    }
    expect(events).toEqual([started, message("one"), { kind: "finished", ok: false, cancelled: true }]);
    expect(eventSequenceProblems(events)).toEqual([]);
  });

  it("cuts a pending delay short when aborted", async () => {
    const controller = new AbortController();
    const adapter = new ReplayAdapter({ events: recorded, delayMs: 60_000 });
    const before = Date.now();
    const events: RunEvent[] = [];
    for await (const event of adapter.run(input, controller.signal)) {
      events.push(event);
      setTimeout(() => controller.abort(), 10);
    }
    expect(Date.now() - before).toBeLessThan(5_000);
    expect(events.at(-1)).toEqual({ kind: "finished", ok: false, cancelled: true });
  });

  it("still starts with started when aborted before the run", async () => {
    const controller = new AbortController();
    controller.abort();
    const clock = new FakeClock("2026-02-03T04:05:06Z");
    const events = await collect(new ReplayAdapter({ events: recorded, clock, name: "fake" }).run(input, controller.signal));
    expect(events).toEqual([
      { kind: "started", runId: `replay-${clock.now().getTime()}`, harness: "fake", at: "2026-02-03T04:05:06.000Z" },
      { kind: "finished", ok: false, cancelled: true },
    ]);
  });

  it("adds nothing when aborted after the recorded finished event", async () => {
    const controller = new AbortController();
    const events: RunEvent[] = [];
    for await (const event of new ReplayAdapter({ events: recorded }).run(input, controller.signal)) {
      events.push(event);
      if (event.kind === "finished") controller.abort();
    }
    expect(events).toEqual(recorded);
  });

  it("replays a malformed recording as is, for runner robustness tests", async () => {
    const malformed = [message("no started"), message("no finished")];
    expect(await collect(new ReplayAdapter({ events: malformed }).run(input, new AbortController().signal))).toEqual(
      malformed,
    );
  });

  it("turns an unreadable file into a fatal error and a failed run", async () => {
    const fs = new MemoryFileSystem({ "/streams/bad.jsonl": "{nope" });
    const adapter = new ReplayAdapter({ fs, file: "/streams/bad.jsonl", clock: new FakeClock() });
    const events = await collect(adapter.run(input, new AbortController().signal));
    expect(events.map((e) => e.kind)).toEqual(["started", "error", "finished"]);
    expect(events[1]).toMatchObject({ fatal: true, message: expect.stringMatching(/^\/streams\/bad\.jsonl: line 1: /) });
    expect(events[2]).toEqual({ kind: "finished", ok: false });
  });

  it("checks that the file exists and parses", async () => {
    const fs = new MemoryFileSystem({ "/streams/ok.jsonl": jsonl(recorded) });
    expect(await new ReplayAdapter({ fs, file: "/streams/ok.jsonl" }).check()).toEqual({
      ok: true,
      value: { version: "replay", warnings: [] },
    });
    expect(await new ReplayAdapter({ fs, file: "/streams/missing.jsonl" }).check()).toEqual({
      ok: false,
      error: { kind: "failed", message: "Replay file not found: /streams/missing.jsonl" },
    });
  });
});
