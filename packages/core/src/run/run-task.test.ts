import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FakeClock } from "../clock.js";
import { MemoryFileSystem } from "../fs.js";
import { FakeGit } from "../git.js";
import { loadSpecTree } from "../load.js";
import { NodeFileSystem } from "../node/fs.js";
import { toPosixPath } from "../paths.js";
import { AdapterRegistry } from "./adapter.js";
import { ReplayAdapter } from "./replay-adapter.js";
import { runTask } from "./run-task.js";

const failure = `${toPosixPath(fileURLToPath(new URL("../../../../fixtures/events", import.meta.url)))}/failure.jsonl`;
const tasks = "## T1: Do it []\nstatus: todo\nfiles: src/a.ts\n";

describe("runTask", () => {
  it("calls the hooks in order, and restores the status after a failed run", async () => {
    const fs = new MemoryFileSystem({ "/repo/.git/HEAD": "", "/repo/.specs/a/tasks.md": tasks });
    const tree = await loadSpecTree(fs, "/repo");
    if (!tree.ok) throw new Error(tree.error.message);
    const failing = await new NodeFileSystem().readFile(failure);
    await fs.writeFile("/streams/failure.jsonl", failing);
    const calls: string[] = [];

    const result = await runTask(
      { fs, git: new FakeGit(() => ""), registry: new AdapterRegistry([new ReplayAdapter({ fs, file: "/streams/failure.jsonl" })]), clock: new FakeClock() },
      { ...tree.value, config: { ...tree.value.config, harness: { default: "replay", adapters: {} } } },
      { feature: "a", task: "T1" },
      new AbortController().signal,
      {
        onStarted: ({ harness }) => calls.push(`started ${harness}`),
        onEvent: (event) => calls.push(event.kind),
      },
    );

    expect(calls).toEqual(["started replay", "started", "message", "command", "error", "finished"]);
    expect(result).toMatchObject({
      ok: true,
      value: { ok: false, cancelled: false, harness: "replay", files: [], snapshot: { feature: "a", task: "T1", previous: "todo", line: "status: todo" } },
    });
    expect(result.ok && result.value.recording).toBeUndefined();
    expect(await fs.readFile("/repo/.specs/a/tasks.md")).toBe(tasks);
  });

  it("returns pre-flight errors without touching the status", async () => {
    const fs = new MemoryFileSystem({ "/repo/.git/HEAD": "", "/repo/.specs/a/tasks.md": tasks });
    const tree = await loadSpecTree(fs, "/repo");
    if (!tree.ok) throw new Error(tree.error.message);
    const result = await runTask(
      { fs, git: new FakeGit(() => " M src/a.ts\0"), registry: new AdapterRegistry([new ReplayAdapter({ events: [] })]), clock: new FakeClock() },
      { ...tree.value, config: { ...tree.value.config, harness: { default: "replay", adapters: {} } } },
      { feature: "a", task: "T1" },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, error: { kind: "dirty-tree" } });
    expect(await fs.readFile("/repo/.specs/a/tasks.md")).toBe(tasks);
  });
});
