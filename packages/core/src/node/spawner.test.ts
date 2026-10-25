import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { NodeSpawner } from "./spawner.js";

const node = process.execPath;
const spawner = new NodeSpawner();
const cwd = tmpdir();

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const items: string[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe("NodeSpawner", () => {
  it("streams stdout and stderr line by line and reports the exit code", async () => {
    const script = 'console.log("one"); console.error("warn"); process.stdout.write("two\\r\\nthree"); process.exit(4)';
    const child = spawner.spawn(node, ["-e", script], { cwd });
    // Read stderr first: output is buffered, so the order does not matter.
    expect(await collect(child.stderr)).toEqual(["warn"]);
    expect(await collect(child.stdout)).toEqual(["one", "two", "three"]);
    expect(await child.exit).toEqual({ code: 4, signal: null });
  });

  it("passes stdin and arguments without a shell", async () => {
    const script = 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(process.argv[1], s))';
    const child = spawner.spawn(node, ["-e", script, "$HOME; echo not-a-shell"], { cwd, stdin: "from stdin" });
    expect(await collect(child.stdout)).toEqual(["$HOME; echo not-a-shell from stdin"]);
    expect((await child.exit).code).toBe(0);
  });

  it("does not stall when a large stderr is never read", async () => {
    const script = 'process.stderr.write("x".repeat(1 << 20)); console.log("done")';
    const child = spawner.spawn(node, ["-e", script], { cwd });
    expect(await collect(child.stdout)).toEqual(["done"]);
    expect((await child.exit).code).toBe(0);
  });

  it("kills a running process", async () => {
    const child = spawner.spawn(node, ["-e", 'console.log("up"); setInterval(() => {}, 1000)'], { cwd });
    for await (const line of child.stdout) {
      expect(line).toBe("up");
      child.kill("SIGTERM");
    }
    const exit = await child.exit;
    expect(exit.code === null || exit.code !== 0).toBe(true);
  });

  it("reports a missing binary instead of throwing", async () => {
    const child = spawner.spawn("specflow-no-such-binary", [], { cwd });
    expect(await collect(child.stdout)).toEqual([]);
    expect(await child.exit).toMatchObject({ code: null, error: { code: "ENOENT" } });
  });
});
