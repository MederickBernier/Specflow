import type { FileSystem } from "../fs.js";
import { fullRef } from "../lint/refs.js";
import { restoreMetadataLine, setMetadataLine } from "../metadata.js";
import type { SpecTree, Task } from "../model.js";
import { parseTasks } from "../parse/tasks.js";
import { joinPath } from "../paths.js";
import { err, ok, type Result } from "../result.js";

/** A task's status line as it was before {@link setTaskStatus}; `line` is null when it had none. */
export type StatusSnapshot = {
  feature: string;
  task: string;
  previous: Task["status"];
  line: string | null;
};

/** Why the status line could not be changed. */
export type StatusError = { kind: "unknown-task"; message: string };

/** Path of a feature's `tasks.md`, relative to the spec root, for staging with a run's changes. */
export function tasksFile(tree: SpecTree, feature: string): string {
  return `${tree.config.specsDir}/${feature}/tasks.md`;
}

/**
 * Sets a task's `status:` line to `status`, changing no other line
 * (task-run/R7). The line is inserted right after the heading when missing.
 * The file is read again first, since the harness may have edited it.
 * Returns what to pass to {@link restoreTaskStatus} to undo the change.
 */
export async function setTaskStatus(
  fs: FileSystem,
  tree: SpecTree,
  target: { feature: string; task: string },
  status: Task["status"],
): Promise<Result<StatusSnapshot, StatusError>> {
  const found = await locate(fs, tree, target);
  if (!found.ok) return found;
  const { file, text, task } = found.value;
  const edited = setMetadataLine(text, task.location.startLine, "status", status);
  await fs.writeFile(file, edited.text);
  return ok({ feature: target.feature, task: target.task, previous: task.status, line: edited.previous });
}

/** Puts a task's status line back exactly as `snapshot` recorded it, removing it if there was none. */
export async function restoreTaskStatus(
  fs: FileSystem,
  tree: SpecTree,
  snapshot: StatusSnapshot,
): Promise<Result<void, StatusError>> {
  const found = await locate(fs, tree, snapshot);
  if (!found.ok) return found;
  const { file, text, task } = found.value;
  const restored = restoreMetadataLine(text, task.location.startLine, "status", snapshot.line);
  if (restored === undefined) {
    return err({ kind: "unknown-task", message: `${fullRef(snapshot.feature, snapshot.task)} has no status line to restore` });
  }
  if (restored !== text) await fs.writeFile(file, restored);
  return ok(undefined);
}

// Finds the task in the current file.
async function locate(fs: FileSystem, tree: SpecTree, target: { feature: string; task: string }) {
  const unknown = err<StatusError>({ kind: "unknown-task", message: `No task ${fullRef(target.feature, target.task)}` });
  const feature = tree.features.find((f) => f.name === target.feature);
  if (!feature) return unknown;
  const file = joinPath(feature.dir, "tasks.md");
  if (!(await fs.exists(file))) return unknown;

  const text = await fs.readFile(file);
  const { tasks } = parseTasks(text, { file, feature: feature.name, prefix: tree.config.ids.task });
  const task = tasks.find((t) => t.id === target.task);
  if (!task) return unknown;
  return ok({ file, text, task });
}
