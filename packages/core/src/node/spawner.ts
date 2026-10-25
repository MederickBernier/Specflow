import { spawn } from "node:child_process";
import { AsyncQueue, LineSplitter } from "../queue.js";
import type { ProcessExit, SpawnedProcess, Spawner } from "../spawner.js";

/** {@link Spawner} over `child_process.spawn`, never through a shell. */
export class NodeSpawner implements Spawner {
  readonly #env: NodeJS.ProcessEnv | undefined;

  /** `env` replaces the inherited environment when given. */
  constructor(options: { env?: NodeJS.ProcessEnv } = {}) {
    this.#env = options.env;
  }

  spawn(command: string, args: string[], options: { cwd: string; stdin?: string }): SpawnedProcess {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: this.#env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });

    const stdout = new AsyncQueue<string>();
    const stderr = new AsyncQueue<string>();
    const outLines = new LineSplitter((line) => stdout.push(line));
    const errLines = new LineSplitter((line) => stderr.push(line));
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => outLines.write(chunk));
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => errLines.write(chunk));

    if (options.stdin !== undefined && child.stdin) {
      // The process may exit before reading its input; that is not our error.
      child.stdin.on("error", () => {});
      child.stdin.end(options.stdin);
    }

    const exit = new Promise<ProcessExit>((resolve) => {
      let startError: NodeJS.ErrnoException | undefined;
      let settled = false;
      const finish = (code: number | null, signal: string | null) => {
        if (settled) return;
        settled = true;
        outLines.flush();
        errLines.flush();
        stdout.end();
        stderr.end();
        resolve({
          code,
          signal,
          ...(startError && { error: { ...(startError.code && { code: startError.code }), message: startError.message } }),
        });
      };
      child.on("error", (error: NodeJS.ErrnoException) => {
        startError = error;
        // A process that never started emits no "close" on every platform.
        if (child.pid === undefined) finish(null, null);
      });
      child.on("close", (code, signal) => finish(code, signal));
    });

    return {
      stdout,
      stderr,
      exit,
      kill: (signal) => {
        if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      },
    };
  }
}
