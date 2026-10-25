/** Time source injected into `core`, so tests control it. */
export interface Clock {
  now(): Date;
}

/** {@link Clock} for tests: starts at `start` and only moves on `advance` or `set`. */
export class FakeClock implements Clock {
  #now: number;

  constructor(start: Date | string = "2026-01-01T00:00:00Z") {
    this.#now = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.#now);
  }

  /** Moves time forward by `ms` milliseconds. */
  advance(ms: number): void {
    this.#now += ms;
  }

  /** Jumps to `time`. */
  set(time: Date | string): void {
    this.#now = new Date(time).getTime();
  }
}
