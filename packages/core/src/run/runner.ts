import type { Clock } from "../clock.js";
import type { FileSystem } from "../fs.js";
import type { Git } from "../git.js";
import { gitStatus } from "../git-status.js";
import type { SpecTree } from "../model.js";
import { err, ok, type Result } from "../result.js";
import type { AdapterRegistry, HarnessCheckError } from "./adapter.js";
import type { RunEvent } from "./events.js";
import { buildTaskPrompt, type PromptError } from "./prompt.js";

/** How long a cancelled run may take to stop before the runner ends it itself (task-run/R5). */
export const cancelGraceMs = 5_000;

/** What the runner needs from its shell. */
export type RunnerDeps = {
  fs: FileSystem;
  git: Git;
  registry: AdapterRegistry;
  clock: Clock;
  /** Overrides {@link cancelGraceMs}, for tests. */
  cancelGraceMs?: number;
};

/** One task to run. */
export type RunRequest = {
  feature: string;
  task: string;
  /** Adapter name; defaults to `harness.default` from config. */
  harness?: string;
  /** Run even with uncommitted changes outside the specs folder. */
  allowDirty?: boolean;
};

/** Why a run did not start. Nothing has been sent to the harness. */
export type RunError =
  | PromptError
  | { kind: "unknown-adapter"; name: string; known: string[]; message: string }
  | { kind: "dirty-tree"; files: string[]; message: string }
  | { kind: "harness-unavailable"; harness: string; check: HarnessCheckError; message: string }
  | { kind: "git-failed"; message: string };

/** A started run. `events` starts the harness when iterated. */
export type RunHandle = {
  harness: string;
  prompt: string;
  /** Non-fatal problems from the harness check, such as an untested version. */
  warnings: string[];
  /** Exactly one `started` first and one `finished` last, whatever the adapter does. */
  events: AsyncIterable<RunEvent>;
};

/**
 * Prepares one task run: builds the prompt, picks the adapter, refuses a
 * dirty tree (task-run/R10) and checks the harness, all before anything is
 * sent. Aborting `signal` cancels the run; if the harness has not finished
 * within {@link cancelGraceMs}, the runner emits the cancelled `finished`
 * event itself (task-run/R5).
 */
export async function startRun(
  deps: RunnerDeps,
  tree: SpecTree,
  request: RunRequest,
  signal: AbortSignal,
): Promise<Result<RunHandle, RunError>> {
  const prompt = await buildTaskPrompt(deps.fs, tree, { feature: request.feature, task: request.task });
  if (!prompt.ok) return prompt;

  const adapter = deps.registry.resolve(tree.config, request.harness);
  if (!adapter.ok) return adapter;
  const harness = adapter.value;

  if (!request.allowDirty) {
    const status = await gitStatus(deps.git, tree.root, [".", `:(exclude)${tree.config.specsDir}`]);
    if (!status.ok) return err({ kind: "git-failed", message: status.error.message });
    if (status.value.length > 0) {
      const files = status.value.map((entry) => entry.path);
      return err({
        kind: "dirty-tree",
        files,
        message: `Uncommitted changes outside ${tree.config.specsDir}/:\n${files.map((f) => `  ${f}`).join("\n")}\nCommit or stash them, or pass --allow-dirty.`,
      });
    }
  }

  const check = await harness.check();
  if (!check.ok) {
    return err({ kind: "harness-unavailable", harness: harness.name, check: check.error, message: check.error.message });
  }

  const input = {
    cwd: tree.root,
    prompt: prompt.value,
    extraArgs: tree.config.harness.adapters[harness.name]?.extraArgs ?? [],
  };
  return ok({
    harness: harness.name,
    prompt: prompt.value,
    warnings: check.value.warnings,
    events: supervise(() => harness.run(input, signal), {
      harness: harness.name,
      signal,
      clock: deps.clock,
      graceMs: deps.cancelGraceMs ?? cancelGraceMs,
    }),
  });
}

// Enforces the event rules on whatever the adapter emits, and bounds how long
// a cancelled run can take.
async function* supervise(
  run: () => AsyncIterable<RunEvent>,
  context: { harness: string; signal: AbortSignal; clock: Clock; graceMs: number },
): AsyncGenerator<RunEvent> {
  const { signal, graceMs } = context;
  const iterator = run()[Symbol.asyncIterator]();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const graceOver = new Promise<"grace-over">((resolve) => {
    const onAbort = () => (timer = setTimeout(() => resolve("grace-over"), graceMs));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });

  let started = false;
  const start = function* (): Generator<RunEvent> {
    if (started) return;
    started = true;
    const now = context.clock.now();
    yield { kind: "started", runId: `run-${now.getTime()}`, harness: context.harness, at: now.toISOString() };
  };
  const cancelled: RunEvent = { kind: "finished", ok: false, cancelled: true };

  try {
    for (;;) {
      let next: IteratorResult<RunEvent> | "grace-over";
      try {
        const pending = iterator.next();
        pending.catch(() => {});
        next = await Promise.race([pending, graceOver]);
      } catch (error) {
        yield* start();
        if (signal.aborted) {
          yield cancelled;
        } else {
          yield { kind: "error", message: `Harness failed: ${(error as Error).message ?? error}`, fatal: true };
          yield { kind: "finished", ok: false };
        }
        return;
      }

      if (next === "grace-over") {
        yield* start();
        yield {
          kind: "error",
          message: `${context.harness} did not stop within ${graceMs / 1000} s of being cancelled`,
          fatal: false,
        };
        yield cancelled;
        return;
      }

      if (next.done) break;
      const event = next.value;
      if (event.kind === "started") {
        if (!started) {
          started = true;
          yield event;
        }
        continue;
      }
      yield* start();
      if (event.kind === "finished") {
        yield signal.aborted && !event.ok ? { ...event, cancelled: true } : event;
        return;
      }
      yield event;
    }

    yield* start();
    if (signal.aborted) {
      yield cancelled;
    } else {
      yield { kind: "error", message: `${context.harness} ended without reporting a result`, fatal: true };
      yield { kind: "finished", ok: false };
    }
  } finally {
    clearTimeout(timer);
    // Stops the adapter (and its process) without waiting on it.
    iterator.return?.()?.catch(() => {});
  }
}
