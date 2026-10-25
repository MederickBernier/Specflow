/** Timer functions, injectable for tests. */
export type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Runs `fn` once `ms` after the last `trigger`, however many triggers came before. */
export class Debouncer {
  readonly #ms: number;
  readonly #fn: () => void;
  readonly #timers: Timers;
  #handle: unknown;

  constructor(ms: number, fn: () => void, timers: Timers = realTimers) {
    this.#ms = ms;
    this.#fn = fn;
    this.#timers = timers;
  }

  trigger(): void {
    if (this.#handle !== undefined) this.#timers.clear(this.#handle);
    this.#handle = this.#timers.set(() => {
      this.#handle = undefined;
      this.#fn();
    }, this.#ms);
  }

  /** Cancels a pending run. */
  dispose(): void {
    if (this.#handle !== undefined) this.#timers.clear(this.#handle);
    this.#handle = undefined;
  }
}
