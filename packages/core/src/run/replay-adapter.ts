import type { Clock } from "../clock.js";
import type { FileSystem } from "../fs.js";
import { err, ok, type Result } from "../result.js";
import type { HarnessAdapter, HarnessCheck, HarnessCheckError, RunInput } from "./adapter.js";
import { parseRunEvent, type RunEvent } from "./events.js";

/** Waits `ms`, resolving early when `signal` aborts. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

/** Where a {@link ReplayAdapter} gets its events: given directly, or a `.jsonl` file read when the run starts. */
export type ReplaySource = { events: RunEvent[] } | { fs: FileSystem; file: string };

/** Options for {@link ReplayAdapter}. */
export type ReplayOptions = ReplaySource & {
  /** Registry name. Defaults to `replay`. */
  name?: string;
  /** Pause between events, in milliseconds. Defaults to 0. */
  delayMs?: number;
  /** Replaces the timer, so tests can control time. */
  sleep?: Sleep;
  /** Time for synthesized `started` events. Defaults to the system time. */
  clock?: Clock;
};

/**
 * Parses a `.jsonl` stream with one {@link RunEvent} per line. Blank lines
 * are skipped. Errors name the 1-based line.
 */
export function parseEventStream(text: string): Result<RunEvent[], string> {
  const events: RunEvent[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      return err(`line ${index + 1}: invalid JSON: ${(error as Error).message}`);
    }
    const event = parseRunEvent(value);
    if (!event.ok) return err(`line ${index + 1}: ${event.error}`);
    events.push(event.value);
  }
  return ok(events);
}

/**
 * {@link HarnessAdapter} that replays recorded events in order, so the runner
 * and UI can be tested without a live harness. Events are replayed as
 * recorded, even a malformed sequence, except that aborting stops the replay
 * with a cancelled `finished`. Every {@link RunInput} it receives is kept in
 * `inputs`.
 */
export class ReplayAdapter implements HarnessAdapter {
  readonly name: string;
  /** Inputs of every run, in order. */
  readonly inputs: RunInput[] = [];
  readonly #source: ReplaySource;
  readonly #delayMs: number;
  readonly #sleep: Sleep;
  readonly #clock: Clock;

  constructor(options: ReplayOptions) {
    this.name = options.name ?? "replay";
    this.#source = "events" in options ? { events: options.events } : { fs: options.fs, file: options.file };
    this.#delayMs = options.delayMs ?? 0;
    this.#sleep = options.sleep ?? sleep;
    this.#clock = options.clock ?? { now: () => new Date() };
  }

  async check(): Promise<Result<HarnessCheck, HarnessCheckError>> {
    const events = await this.#load();
    return events.ok ? ok({ version: "replay", warnings: [] }) : err({ kind: "failed", message: events.error });
  }

  async *run(input: RunInput, signal: AbortSignal): AsyncIterable<RunEvent> {
    this.inputs.push(input);
    const events = await this.#load();
    if (!events.ok) {
      yield this.#started();
      yield { kind: "error", message: events.error, fatal: true };
      yield { kind: "finished", ok: false };
      return;
    }

    let started = false;
    let finished = false;
    for (const [index, event] of events.value.entries()) {
      if (index > 0 && this.#delayMs > 0) await this.#sleep(this.#delayMs, signal);
      if (signal.aborted) break;
      yield event;
      started ||= event.kind === "started";
      finished ||= event.kind === "finished";
    }

    if (signal.aborted && !finished) {
      if (!started) yield this.#started();
      yield { kind: "finished", ok: false, cancelled: true };
    }
  }

  async #load(): Promise<Result<RunEvent[], string>> {
    if ("events" in this.#source) return ok(this.#source.events);
    const { fs, file } = this.#source;
    if (!(await fs.exists(file))) return err(`Replay file not found: ${file}`);
    const parsed = parseEventStream(await fs.readFile(file));
    return parsed.ok ? parsed : err(`${file}: ${parsed.error}`);
  }

  #started(): RunEvent {
    const now = this.#clock.now();
    return { kind: "started", runId: `replay-${now.getTime()}`, harness: this.name, at: now.toISOString() };
  }
}

const sleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
