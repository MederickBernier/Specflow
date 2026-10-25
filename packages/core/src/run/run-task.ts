import type { SpecTree } from "../model.js";
import { err, ok, type Result } from "../result.js";
import type { RunEvent } from "./events.js";
import { changedFiles, type Recording, recordRun } from "./recorder.js";
import { type RunError, type RunnerDeps, type RunRequest, startRun } from "./runner.js";
import { checkScope, type ScopeReport } from "./scope.js";
import { extractSpecNotes } from "./spec-notes.js";
import { restoreTaskStatus, type StatusError, type StatusSnapshot, setTaskStatus, tasksFile } from "./status.js";

/** Callbacks while a task runs. */
export type RunTaskHooks = {
  /** After the pre-flight checks passed and the task is `doing`, before the harness starts. */
  onStarted?: (info: { harness: string; prompt: string; warnings: string[] }) => void;
  /** Every event, as it arrives. */
  onEvent?: (event: RunEvent) => void;
};

/** A finished run, recorded or not. */
export type RunTaskResult = {
  ok: boolean;
  cancelled: boolean;
  harness: string;
  warnings: string[];
  events: RunEvent[];
  /** Every file the run changed, relative to the spec root. */
  files: string[];
  scope: ScopeReport;
  specNotes: string[];
  /** Undefined when nothing was recorded: the run failed, was cancelled, or changed no code. */
  recording?: Recording;
  /** The task's status line before the run, to undo `done` when a staged result is discarded. */
  snapshot: StatusSnapshot;
};

/** Why a run did not happen, or could not be recorded. */
export type RunTaskError = RunError | StatusError | { kind: "record-failed"; message: string };

/**
 * One task, start to finish, for every shell (task-run/R4 to R7, R11, R12):
 * pre-flight checks, `doing`, the event stream, then on success `done` and
 * recording of the changed code plus `tasks.md`; on failure, cancellation or
 * no code changes, the status line is restored. Harness edits to spec files
 * are left out of the recording.
 */
export async function runTask(
  deps: RunnerDeps,
  tree: SpecTree,
  request: RunRequest,
  signal: AbortSignal,
  hooks: RunTaskHooks = {},
): Promise<Result<RunTaskResult, RunTaskError>> {
  const target = { feature: request.feature, task: request.task };
  const handle = await startRun(deps, tree, request, signal);
  if (!handle.ok) return handle;

  const status = await setTaskStatus(deps.fs, tree, target, "doing");
  if (!status.ok) return status;
  const snapshot = status.value;
  hooks.onStarted?.({ harness: handle.value.harness, prompt: handle.value.prompt, warnings: handle.value.warnings });

  const events: RunEvent[] = [];
  for await (const event of handle.value.events) {
    events.push(event);
    hooks.onEvent?.(event);
  }

  const finished = events.at(-1);
  const succeeded = finished?.kind === "finished" && finished.ok;
  const cancelled = finished?.kind === "finished" && finished.cancelled === true;
  const files = changedFiles(events);
  const planned = tree.features.find((f) => f.name === request.feature)!.tasks.find((t) => t.id === request.task)!;
  const scope = checkScope(tree, planned, files);
  const codeFiles = files.filter((file) => !scope.specEdits.includes(file));
  const lastMessage = events.findLast((e) => e.kind === "message");
  const reply = (finished?.kind === "finished" && finished.summary) || (lastMessage?.kind === "message" ? lastMessage.text : "");
  const specNotes = extractSpecNotes(reply).notes;

  let recording: Recording | undefined;
  if (succeeded && codeFiles.length > 0) {
    await setTaskStatus(deps.fs, tree, target, "done");
    const recorded = await recordRun({ git: deps.git, fs: deps.fs }, tree, target, {
      ok: true,
      ...(finished.summary !== undefined && { summary: finished.summary }),
      files: [...codeFiles, tasksFile(tree, request.feature)],
    });
    if (!recorded.ok) {
      await restoreTaskStatus(deps.fs, tree, snapshot);
      return err({ kind: "record-failed", message: `The run succeeded but could not be recorded: ${recorded.error.message}` });
    }
    recording = recorded.value;
  } else {
    await restoreTaskStatus(deps.fs, tree, snapshot);
  }

  return ok({
    ok: succeeded,
    cancelled,
    harness: handle.value.harness,
    warnings: handle.value.warnings,
    events,
    files,
    scope,
    specNotes,
    ...(recording && { recording }),
    snapshot,
  });
}
