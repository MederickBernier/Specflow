import { type Recording, type RunEvent, runTask, tasksFile } from "@specflow/core";
import { loadOrReport, relativePath, writeJsonLine } from "../output.js";
import { exitCodes, type Io } from "../program.js";

/** JSON schema ID of each line of `specflow run --json`. Bump the version on breaking changes. */
export const runSchema = "specflow.run/v1";

/**
 * `specflow run <feature>/<task>`: runs one task, streaming its events. On
 * success the task becomes `done` and the result is recorded per
 * `commit.mode`; on failure or cancel its status is restored. Ctrl+C cancels.
 */
export async function runCommand(
  io: Io,
  target: string,
  options: { harness?: string; allowDirty: boolean; json: boolean },
): Promise<number> {
  const tree = await loadOrReport(io, runSchema, options.json, writeJsonLine);
  if (typeof tree === "number") return tree;
  const fail = (kind: string, message: string, code: number = exitCodes.failed) => {
    if (options.json) writeJsonLine(io, { schema: runSchema, error: { kind, message } });
    else io.stderr(`specflow: ${message}\n`);
    return code;
  };

  const [feature, task, extra] = target.split("/");
  if (!feature || !task || extra !== undefined) {
    return fail("bad-target", `Expected <feature>/<task>, such as auth/T3, not "${target}"`, exitCodes.unusable);
  }

  const controller = new AbortController();
  const stopListening = io.onInterrupt(() => {
    if (!options.json) io.stderr("\nCancelling... (press Ctrl+C again to quit now)\n");
    controller.abort();
  });
  let result: Awaited<ReturnType<typeof runTask>>;
  try {
    result = await runTask(
      { fs: io.fs, git: io.git, registry: io.registry, clock: io.clock },
      tree,
      { feature, task, ...(options.harness !== undefined && { harness: options.harness }), allowDirty: options.allowDirty },
      controller.signal,
      {
        onStarted: ({ warnings }) => {
          for (const warning of warnings) {
            if (options.json) writeJsonLine(io, { schema: runSchema, warning });
            else io.stderr(`specflow: warning: ${warning}\n`);
          }
        },
        onEvent: (event) => {
          if (options.json) writeJsonLine(io, { schema: runSchema, event });
          else io.stdout(renderEvent(event, `${feature}/${task}`));
        },
      },
    );
  } finally {
    stopListening();
  }
  if (!result.ok) {
    const install = result.error.kind === "harness-unavailable" && result.error.check.installUrl;
    return fail(result.error.kind, install ? `${result.error.message}\nSee ${install}` : result.error.message);
  }
  const { ok, cancelled, files, recording, scope, specNotes } = result.value;

  if (options.json) {
    writeJsonLine(io, {
      schema: runSchema,
      result: { ok, cancelled, files, recording: recording ?? null, ...scope, specNotes },
    });
  } else {
    io.stdout(renderOutcome(tree.root, { ok, cancelled, files, recording }));
    io.stdout(renderFollowUp(task, tasksFile(tree, feature), scope, specNotes));
  }
  if (cancelled) return exitCodes.cancelled;
  return ok ? exitCodes.ok : exitCodes.failed;
}

const changeMarks = { added: "+", modified: "~", deleted: "-" } as const;

function renderEvent(event: RunEvent, target: string): string {
  switch (event.kind) {
    case "started":
      return `Running ${target} with ${event.harness}\n\n`;
    case "message":
      return `${event.text.trim()}\n\n`;
    case "tool-call":
      return `  > ${event.tool} ${event.summary}\n`;
    case "file-changed":
      return `  ${changeMarks[event.change]} ${event.path}\n`;
    case "command":
      return `  $ ${event.command}${event.exitCode === undefined ? "" : ` (exit ${event.exitCode})`}\n`;
    case "usage": {
      const parts = [
        event.inputTokens !== undefined && `${event.inputTokens.toLocaleString("en-US")} tokens in`,
        event.outputTokens !== undefined && `${event.outputTokens.toLocaleString("en-US")} out`,
        event.costUsd !== undefined && `$${event.costUsd.toFixed(2)}`,
        event.durationMs !== undefined && `${(event.durationMs / 1000).toFixed(1)} s`,
      ].filter(Boolean);
      return parts.length > 0 ? `\nUsage: ${parts.join(", ")}\n` : "";
    }
    case "error":
      return `  ! ${event.fatal ? "error" : "warning"}: ${event.message}\n`;
    case "finished":
      return event.cancelled ? "\nCancelled.\n" : event.ok ? "\nFinished.\n" : "\nFailed.\n";
  }
}

function renderFollowUp(
  task: string,
  statusFile: string,
  scope: { specEdits: string[]; outOfScope: string[] },
  specNotes: string[],
): string {
  const lines: string[] = [];
  if (scope.outOfScope.length > 0) {
    lines.push(`Warning: changed outside ${task}'s files list (recorded, check they belong to this task):`);
    lines.push(...scope.outOfScope.map((file) => `  ${file}`));
  }
  const unstaged = scope.specEdits.filter((file) => file !== statusFile);
  if (unstaged.length > 0) {
    lines.push("Warning: the harness edited spec files; left unstaged for review:");
    lines.push(...unstaged.map((file) => `  ${file}`));
  }
  if (scope.specEdits.includes(statusFile)) {
    lines.push(`Warning: the harness edited ${statusFile}; it is recorded with the status change, check its diff.`);
  }
  if (specNotes.length > 0) {
    lines.push("Spec notes from the agent (not applied):");
    lines.push(...specNotes.map((note) => `  - ${note}`));
  }
  return lines.length > 0 ? `\n${lines.join("\n")}\n` : "";
}

function renderOutcome(
  root: string,
  outcome: { ok: boolean; cancelled: boolean; files: string[]; recording: Recording | undefined },
): string {
  const { recording } = outcome;
  if (outcome.cancelled) return "Task status restored. Changes made before cancelling are left in place.\n";
  if (!outcome.ok) return "Task status restored. Changes made during the run are left in place.\n";
  if (!recording) return "No files changed, so nothing was recorded and the task status was restored.\n";
  if (recording.mode === "staged") {
    return (
      `Staged ${recording.files.length} files and marked the task done. Review, then commit with:\n` +
      `  git commit -F ${relativePath(root, recording.messageFile)}\n`
    );
  }
  if (recording.mode === "auto") {
    return `Committed ${recording.commit.slice(0, 7)} with ${recording.files.length} files and marked the task done.\n`;
  }
  return "";
}
