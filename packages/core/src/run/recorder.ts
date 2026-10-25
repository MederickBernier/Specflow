import type { FileSystem } from "../fs.js";
import type { Git } from "../git.js";
import { fullRef } from "../lint/refs.js";
import type { SpecTree } from "../model.js";
import { joinPath, toPosixPath } from "../paths.js";
import { err, ok, type Result } from "../result.js";
import type { RunEvent } from "./events.js";

/** File name of the prepared message in staged mode, inside the git directory. */
export const messageFileName = "SPECFLOW_MSG";

/** What the recorder needs to know about a finished run. */
export type RunOutcome = {
  ok: boolean;
  cancelled?: boolean;
  /** `finished.summary`, used as the commit body. */
  summary?: string;
  /** Changed paths relative to the spec root, as reported by `file-changed` events. */
  files: string[];
};

/** What the recorder did. */
export type Recording =
  | { mode: "staged"; message: string; messageFile: string; files: string[] }
  | { mode: "auto"; message: string; commit: string; files: string[] }
  | { mode: "skipped"; reason: "failed" | "cancelled" | "no-changes" };

/** The recorder could not finish; `message` holds git's error. */
export type RecordError = { kind: "unknown-task" | "git-failed"; message: string };

/** Paths from `file-changed` events, without duplicates, in first-seen order. */
export function changedFiles(events: readonly RunEvent[]): string[] {
  return [...new Set(events.flatMap((e) => (e.kind === "file-changed" ? [e.path] : [])))];
}

/**
 * Records a finished run in git (task-run/R6). In `staged` mode the changed
 * files are staged and the prepared message, with trailers, is written to
 * `<git dir>/SPECFLOW_MSG` and returned; nothing is committed. In `auto` mode
 * exactly those files are committed, leaving anything else that was staged
 * alone. A failed or cancelled run, or one with no changes, touches nothing.
 */
export async function recordRun(
  deps: { git: Git; fs: FileSystem },
  tree: SpecTree,
  target: { feature: string; task: string },
  run: RunOutcome,
): Promise<Result<Recording, RecordError>> {
  if (run.cancelled) return ok({ mode: "skipped", reason: "cancelled" });
  if (!run.ok) return ok({ mode: "skipped", reason: "failed" });
  if (run.files.length === 0) return ok({ mode: "skipped", reason: "no-changes" });

  const task = tree.features.find((f) => f.name === target.feature)?.tasks.find((t) => t.id === target.task);
  if (!task) return err({ kind: "unknown-task", message: `No task ${fullRef(target.feature, target.task)}` });

  const git = (args: string[], stdin?: string) =>
    deps.git.run(args, { cwd: tree.root, ...(stdin !== undefined && { stdin }) });

  const subject = `feat(${task.feature}): ${task.title}`;
  const body = run.summary?.trim();
  let message = body ? `${subject}\n\n${body}\n` : `${subject}\n`;
  if (tree.config.commit.trailers) {
    const trailers = [
      `Spec-Feature: ${task.feature}`,
      `Spec-Task: ${task.id}`,
      `Spec-Req: ${task.reqs.length > 0 ? task.reqs.join(", ") : "none"}`,
    ];
    const withTrailers = await git(["interpret-trailers", ...trailers.flatMap((t) => ["--trailer", t])], message);
    if (!withTrailers.ok) return err({ kind: "git-failed", message: withTrailers.error.message });
    message = withTrailers.value;
  }

  // Literal pathspecs, so file names with * or [ are never globs.
  const pathspec = run.files.map((file) => `:(literal)${file}`);
  const added = await git(["add", "-A", "--", ...pathspec]);
  if (!added.ok) return err({ kind: "git-failed", message: added.error.message });

  if (tree.config.commit.mode === "staged") {
    const gitDir = await git(["rev-parse", "--absolute-git-dir"]);
    if (!gitDir.ok) return err({ kind: "git-failed", message: gitDir.error.message });
    const messageFile = joinPath(toPosixPath(gitDir.value.trim()), messageFileName);
    await deps.fs.writeFile(messageFile, message);
    return ok({ mode: "staged", message, messageFile, files: run.files });
  }

  const committed = await git(["commit", "--quiet", "-F", "-", "--", ...pathspec], message);
  if (!committed.ok) return err({ kind: "git-failed", message: committed.error.message });
  const head = await git(["rev-parse", "HEAD"]);
  if (!head.ok) return err({ kind: "git-failed", message: head.error.message });
  return ok({ mode: "auto", message, commit: head.value.trim(), files: run.files });
}
