import { type Finding, fullRef, type Requirement, resolveRef, type SpecTree, type Task, type TraceCommit } from "@specflow/core";

/** The run lens above a task heading (vscode-extension/R4). */
export function taskLensTitle(task: Task): string {
  return task.status === "done" ? `$(play) Run ${task.id} again` : `$(play) Run ${task.id}`;
}

/**
 * The summary lens above a requirement heading (vscode-extension/R7):
 * number of tasks, date of the last commit referencing it, number of drift findings.
 */
export function requirementLensTitle(
  tree: SpecTree,
  requirement: Requirement,
  commits: readonly TraceCommit[],
  drift: readonly Finding[] | undefined,
): string {
  const key = fullRef(requirement.feature, requirement.id);
  const tasks = tree.features.flatMap((f) =>
    f.tasks.filter((t) => t.reqs.some((ref) => {
      const target = resolveRef(ref, f.name);
      return fullRef(target.feature, target.id) === key;
    })),
  );
  const last = commits.find((c) => c.reqs.includes(key));
  const findings = drift?.filter((f) => f.feature === requirement.feature && f.id === requirement.id).length;
  return [
    `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`,
    last ? `last commit ${last.date.slice(0, 10)}` : "no commits",
    findings === undefined ? "drift not checked" : findings === 0 ? "no drift" : `${findings} drift ${findings === 1 ? "finding" : "findings"}`,
  ].join(" · ");
}
