import { matchesGlob } from "../glob.js";
import type { SpecTree, Task } from "../model.js";

/** A run's changed files that the task did not plan (task-run/R11). */
export type ScopeReport = {
  /** Files under the specs folder, which the harness is told not to edit. */
  specEdits: string[];
  /** Other files matching none of the task's `files:` patterns. Empty when the task has no `files:`. */
  outOfScope: string[];
};

/** Sorts a run's changed files, relative to the spec root, against the task's plan. */
export function checkScope(tree: SpecTree, task: Task, files: readonly string[]): ScopeReport {
  const specsPrefix = `${tree.config.specsDir.replace(/\/$/, "")}/`;
  const specEdits = files.filter((file) => file.startsWith(specsPrefix));
  const code = files.filter((file) => !file.startsWith(specsPrefix));
  const outOfScope =
    task.files.length === 0 ? [] : code.filter((file) => !task.files.some((pattern) => matchesGlob(file, pattern)));
  return { specEdits, outOfScope };
}
