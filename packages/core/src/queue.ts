/**
 * An unbounded async queue: producers `push` and `end`, one consumer iterates.
 * Buffering everything keeps a slow consumer of one stream from stalling a
 * process that is also writing to another.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  readonly #items: T[] = [];
  #ended = false;
  #error: unknown;
  #wake: (() => void) | undefined;

  /** Adds an item. Ignored after `end`. */
  push(item: T): void {
    if (this.#ended) return;
    this.#items.push(item);
    this.#notify();
  }

  /** Ends the queue. With `error`, iteration rejects after the buffered items. */
  end(error?: unknown): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#error = error;
    this.#notify();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      if (this.#items.length > 0) {
        yield this.#items.shift()!;
      } else if (this.#ended) {
        if (this.#error !== undefined) throw this.#error;
        return;
      } else {
        await new Promise<void>((resolve) => (this.#wake = resolve));
      }
    }
  }

  #notify(): void {
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
  }
}

/** Splits text chunks into lines, without the `\n` or `\r\n`. Call `flush` at the end. */
export class LineSplitter {
  #partial = "";
  readonly #onLine: (line: string) => void;

  constructor(onLine: (line: string) => void) {
    this.#onLine = onLine;
  }

  write(chunk: string): void {
    const parts = (this.#partial + chunk).split("\n");
    this.#partial = parts.pop()!;
    for (const part of parts) this.#onLine(part.endsWith("\r") ? part.slice(0, -1) : part);
  }

  flush(): void {
    if (this.#partial !== "") this.#onLine(this.#partial.endsWith("\r") ? this.#partial.slice(0, -1) : this.#partial);
    this.#partial = "";
  }
}
