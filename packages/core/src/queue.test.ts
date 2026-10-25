import { describe, expect, it } from "vitest";
import { AsyncQueue, LineSplitter } from "./queue.js";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe("AsyncQueue", () => {
  it("yields items pushed before and during iteration", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    const result = collect(queue);
    queue.push(2);
    setTimeout(() => {
      queue.push(3);
      queue.end();
    }, 5);
    expect(await result).toEqual([1, 2, 3]);
  });

  it("rejects after the buffered items when ended with an error", async () => {
    const queue = new AsyncQueue<string>();
    queue.push("a");
    queue.end(new Error("boom"));
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const item of queue) seen.push(item);
      })(),
    ).rejects.toThrow("boom");
    expect(seen).toEqual(["a"]);
  });

  it("ignores pushes after end", async () => {
    const queue = new AsyncQueue<number>();
    queue.end();
    queue.push(1);
    expect(await collect(queue)).toEqual([]);
  });
});

describe("LineSplitter", () => {
  it("splits chunks on LF and CRLF, keeping partial lines until flushed", () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((line) => lines.push(line));
    splitter.write("one\r\ntw");
    splitter.write("o\n\nthr");
    expect(lines).toEqual(["one", "two", ""]);
    splitter.write("ee");
    splitter.flush();
    expect(lines).toEqual(["one", "two", "", "three"]);
  });
});
