import type { FileSystem } from "../fs.js";
import { fullRef } from "../lint/refs.js";
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

const metadataLine = /^([a-z][a-z-]*):\s*(.*)$/;

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
  const { file, lines, task, headingEnd, statusIndex } = found.value;

  const snapshot: StatusSnapshot = {
    feature: target.feature,
    task: target.task,
    previous: task.status,
    line: statusIndex === undefined ? null : content(lines[statusIndex]!),
  };
  if (statusIndex === undefined) {
    lines.splice(headingEnd + 1, 0, `status: ${status}${ending(lines[headingEnd]!)}`);
  } else {
    // Keep the key's spacing and any trailing whitespace; only the value changes.
    const line = lines[statusIndex]!;
    const [, key, , trailing] = /^(status:\s*)(.*?)(\s*)$/.exec(content(line))!;
    lines[statusIndex] = `${key === "status:" ? "status: " : key}${status}${trailing}${ending(line)}`;
  }
  await fs.writeFile(file, lines.join("\n"));
  return ok(snapshot);
}

/** Puts a task's status line back exactly as `snapshot` recorded it, removing it if there was none. */
export async function restoreTaskStatus(
  fs: FileSystem,
  tree: SpecTree,
  snapshot: StatusSnapshot,
): Promise<Result<void, StatusError>> {
  const found = await locate(fs, tree, snapshot);
  if (!found.ok) return found;
  const { file, lines, statusIndex } = found.value;
  if (statusIndex === undefined) {
    if (snapshot.line === null) return ok(undefined);
    return err({ kind: "unknown-task", message: `${fullRef(snapshot.feature, snapshot.task)} has no status line to restore` });
  }
  if (snapshot.line === null) lines.splice(statusIndex, 1);
  else lines[statusIndex] = snapshot.line + ending(lines[statusIndex]!);
  await fs.writeFile(file, lines.join("\n"));
  return ok(undefined);
}

// Finds the task in the current file. Lines keep their `\r`, so joining with
// `\n` reproduces the file exactly.
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

  const lines = text.split("\n");
  let headingEnd = task.location.startLine - 1;
  // A setext heading's underline is part of the heading.
  if (/^\s{0,3}(-+|=+)\s*$/.test(content(lines[headingEnd + 1] ?? "")) && !/^\s{0,3}#/.test(lines[headingEnd]!)) {
    headingEnd++;
  }
  let statusIndex: number | undefined;
  for (let i = headingEnd + 1; i < lines.length; i++) {
    const meta = metadataLine.exec(content(lines[i]!));
    if (!meta) break;
    if (meta[1] === "status") {
      statusIndex = i;
      break;
    }
  }
  return ok({ file, lines, task, headingEnd, statusIndex });
}

function content(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function ending(line: string): string {
  return line.endsWith("\r") ? "\r" : "";
}
