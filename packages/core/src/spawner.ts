import { AsyncQueue } from "./queue.js";

/** How a spawned process ended. `error` is set when it could not start, for example `ENOENT`. */
export type ProcessExit = {
  code: number | null;
  signal: string | null;
  error?: { code?: string; message: string };
};

/** A running process. Output is buffered from the start, so streams can be read in any order. */
export interface SpawnedProcess {
  /** Stdout, line by line. */
  stdout: AsyncIterable<string>;
  /** Stderr, line by line. */
  stderr: AsyncIterable<string>;
  /** Resolves once the process has exited and its output has ended. Never rejects. */
  exit: Promise<ProcessExit>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

/** Starts processes. Injected into `core`, which never spawns them itself. Arguments are an array, never a shell string. */
export interface Spawner {
  spawn(command: string, args: string[], options: { cwd: string; stdin?: string }): SpawnedProcess;
}

/** What a {@link FakeProcess} prints and how it exits, when scripted up front. */
export type ProcessScript = { stdout?: string[]; stderr?: string[]; exit?: ProcessExit };

/**
 * {@link SpawnedProcess} for tests. Drive it with `writeStdout`, `writeStderr`
 * and `finish`, or let {@link FakeSpawner} play a {@link ProcessScript}.
 * `kill` records the signal and finishes with it, unless the process already ended.
 */
export class FakeProcess implements SpawnedProcess {
  readonly stdout = new AsyncQueue<string>();
  readonly stderr = new AsyncQueue<string>();
  readonly exit: Promise<ProcessExit>;
  /** Signals passed to `kill`, in order. */
  readonly kills: string[] = [];
  #resolve!: (exit: ProcessExit) => void;
  #finished = false;

  constructor() {
    this.exit = new Promise((resolve) => (this.#resolve = resolve));
  }

  writeStdout(...lines: string[]): void {
    for (const line of lines) this.stdout.push(line);
  }

  writeStderr(...lines: string[]): void {
    for (const line of lines) this.stderr.push(line);
  }

  /** Ends both streams and resolves `exit`. Later calls are ignored. */
  finish(exit: ProcessExit = { code: 0, signal: null }): void {
    if (this.#finished) return;
    this.#finished = true;
    this.stdout.end();
    this.stderr.end();
    this.#resolve(exit);
  }

  kill(signal: "SIGTERM" | "SIGKILL"): void {
    this.kills.push(signal);
    this.finish({ code: null, signal });
  }
}

/** One recorded {@link Spawner.spawn} call. */
export type SpawnCall = { command: string; args: string[]; cwd: string; stdin?: string };

/**
 * {@link Spawner} for tests. `handler` decides what each call does: return a
 * {@link ProcessScript} to play it immediately, or a {@link FakeProcess} to
 * drive by hand.
 */
export class FakeSpawner implements Spawner {
  /** Every call, in order. */
  readonly calls: SpawnCall[] = [];
  readonly #handler: (call: SpawnCall) => ProcessScript | FakeProcess;

  constructor(handler: (call: SpawnCall) => ProcessScript | FakeProcess) {
    this.#handler = handler;
  }

  spawn(command: string, args: string[], options: { cwd: string; stdin?: string }): SpawnedProcess {
    const call: SpawnCall = { command, args, cwd: options.cwd, ...(options.stdin !== undefined && { stdin: options.stdin }) };
    this.calls.push(call);
    const outcome = this.#handler(call);
    if (outcome instanceof FakeProcess) return outcome;

    const process = new FakeProcess();
    process.writeStdout(...(outcome.stdout ?? []));
    process.writeStderr(...(outcome.stderr ?? []));
    process.finish(outcome.exit ?? { code: 0, signal: null });
    return process;
  }
}
