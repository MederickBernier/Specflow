import {
  type Clock,
  type Git,
  gitStatus,
  type HarnessAdapter,
  type HarnessCheck,
  type HarnessCheckError,
  type Result,
  type RunEvent,
  type RunInput,
  type Spawner,
} from "@specflow/core";
import { checkClaudeCode } from "./check.js";
import { StreamMapper } from "./mapper.js";

/** Flags every run uses; `extraArgs` from config come after them. */
export const baseArgs = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"];

/** How long after SIGTERM the process gets before SIGKILL (task-run/R5). */
export const killGraceMs = 5_000;

/** Options for {@link ClaudeCodeAdapter}. */
export type ClaudeCodeOptions = {
  spawner: Spawner;
  git: Git;
  clock: Clock;
  /** Executable to run. Defaults to `claude` on PATH. */
  binary?: string;
  /** Working directory for `check()`. Defaults to the process's. */
  cwd?: string;
  /** Platform, for messages. Defaults to `process.platform`. */
  platform?: string;
  /** Overrides {@link killGraceMs}, for tests. */
  killGraceMs?: number;
};

/**
 * Runs a task through Claude Code in print mode with streaming JSON output.
 * The prompt goes on stdin and arguments are an array, never a shell string.
 */
export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly name = "claude-code";
  readonly #spawner: Spawner;
  readonly #git: Git;
  readonly #clock: Clock;
  readonly #binary: string;
  readonly #cwd: string;
  readonly #platform: string;
  readonly #killGraceMs: number;

  constructor(options: ClaudeCodeOptions) {
    this.#spawner = options.spawner;
    this.#git = options.git;
    this.#clock = options.clock;
    this.#binary = options.binary ?? "claude";
    this.#cwd = options.cwd ?? process.cwd();
    this.#platform = options.platform ?? process.platform;
    this.#killGraceMs = options.killGraceMs ?? killGraceMs;
  }

  check(): Promise<Result<HarnessCheck, HarnessCheckError>> {
    return checkClaudeCode(this.#spawner, { binary: this.#binary, cwd: this.#cwd, platform: this.#platform });
  }

  async *run(input: RunInput, signal: AbortSignal): AsyncIterable<RunEvent> {
    const mapper = new StreamMapper({ cwd: input.cwd, harness: this.name, now: () => this.#clock.now() });
    const started = (): RunEvent[] => {
      if (mapper.started) return [];
      mapper.started = true;
      const now = this.#clock.now();
      return [{ kind: "started", runId: `claude-${now.getTime()}`, harness: this.name, at: now.toISOString() }];
    };

    // Changes already present before the run are not the run's.
    const before = await this.#status(input.cwd);
    if (signal.aborted) {
      yield* started();
      yield { kind: "finished", ok: false, cancelled: true };
      return;
    }

    const child = this.#spawner.spawn(this.#binary, [...baseArgs, ...input.extraArgs], {
      cwd: input.cwd,
      stdin: input.prompt,
    });
    let exited = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!exited) child.kill("SIGKILL");
      }, this.#killGraceMs);
    };
    // Checking `aborted` first: a signal aborted before we listen never fires.
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });

    try {
      for await (const line of child.stdout) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        yield* mapper.map(parsed);
      }
      const stderr: string[] = [];
      for await (const line of child.stderr) stderr.push(line);
      const exit = await child.exit;
      exited = true;

      yield* started();
      if (exit.error) {
        const message =
          exit.error.code === "ENOENT"
            ? `Claude Code (${this.#binary}) was not found on PATH`
            : `Could not start ${this.#binary}: ${exit.error.message}`;
        yield { kind: "error", message, fatal: true };
        yield { kind: "finished", ok: false };
        return;
      }

      yield* await this.#unreported(mapper, before, input.cwd);

      const result = mapper.result;
      if (signal.aborted && !result?.ok) {
        yield { kind: "finished", ok: false, cancelled: true };
      } else if (result) {
        for (const message of result.errors) yield { kind: "error", message, fatal: true };
        yield { kind: "finished", ok: result.ok, ...(result.summary && { summary: result.summary }) };
      } else {
        const tail = stderr.filter((l) => l.trim() !== "").slice(-5).join("\n");
        yield {
          kind: "error",
          message: `${this.#binary} exited with code ${exit.code ?? exit.signal} without a result${tail ? `:\n${tail}` : ""}`,
          fatal: true,
        };
        yield { kind: "finished", ok: false };
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (!exited) {
        // The caller stopped reading early; do not leave the harness running.
        child.kill("SIGTERM");
        killTimer ??= setTimeout(() => child.kill("SIGKILL"), this.#killGraceMs);
        void child.exit.then(() => clearTimeout(killTimer));
      } else {
        clearTimeout(killTimer);
      }
    }
  }

  // Status entries under cwd, keyed by path relative to cwd. Undefined outside a git repo.
  async #status(cwd: string): Promise<Map<string, string> | undefined> {
    const prefix = await this.#git.run(["rev-parse", "--show-prefix"], { cwd });
    if (!prefix.ok) return undefined;
    const status = await gitStatus(this.#git, cwd, ["."]);
    if (!status.ok) return undefined;
    const base = prefix.value.trim();
    return new Map(status.value.map((entry) => [entry.path.slice(base.length), entry.code]));
  }

  // Files the model changed without Edit or Write, for example through Bash.
  async #unreported(mapper: StreamMapper, before: Map<string, string> | undefined, cwd: string): Promise<RunEvent[]> {
    if (!before) return [];
    const after = await this.#status(cwd);
    if (!after) return [];
    const events: RunEvent[] = [];
    for (const [path, code] of after) {
      if (before.get(path) === code || mapper.reported.has(path)) continue;
      mapper.reported.add(path);
      const change = code.includes("D") ? "deleted" : code === "??" || code[0] === "A" ? "added" : "modified";
      events.push({ kind: "file-changed", path, change });
    }
    return events;
  }
}
