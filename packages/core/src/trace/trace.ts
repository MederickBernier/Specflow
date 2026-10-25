import { fullRef, resolveRef } from "../lint/refs.js";
import type { Requirement, SpecTree, Task } from "../model.js";
import { err, ok, type Result } from "../result.js";
import type { TraceCommit } from "./commits.js";

/** A task as listed in a trace. */
export type TracedTask = { feature: string; id: string; title: string; status: Task["status"] };

/** What implements one requirement: the tasks referencing it and the commits whose trailers do. */
export type RequirementTrace = {
  feature: string;
  id: string;
  title: string;
  tasks: TracedTask[];
  commits: TraceCommit[];
};

/** One task, the requirements it references, and the commits whose trailers name it. */
export type TaskTrace = TracedTask & { reqs: string[]; commits: TraceCommit[] };

/** Every requirement and task of a feature, traced. */
export type FeatureTrace = { feature: string; requirements: RequirementTrace[]; tasks: TaskTrace[] };

/** What `trace` returns, by the kind of target. */
export type Trace =
  | { kind: "requirement"; trace: RequirementTrace }
  | { kind: "task"; trace: TaskTrace }
  | { kind: "feature"; trace: FeatureTrace };

/** The target is not in the spec tree. */
export type TraceError = { kind: "not-found"; message: string };

/**
 * Traces `feature`, `feature/R<n>` or `feature/T<n>` (task-run/R8) through
 * `commits` from {@link readTraceCommits}, keeping their newest-first order.
 */
export function trace(tree: SpecTree, commits: readonly TraceCommit[], target: string): Result<Trace, TraceError> {
  const slash = target.indexOf("/");
  const name = slash === -1 ? target : target.slice(0, slash);
  const id = slash === -1 ? undefined : target.slice(slash + 1);
  const feature = tree.features.find((f) => f.name === name);
  if (!feature) return err({ kind: "not-found", message: `No feature ${name}` });

  if (id === undefined) {
    return ok({
      kind: "feature",
      trace: {
        feature: feature.name,
        requirements: feature.requirements.map((r) => traceRequirement(tree, commits, r)),
        tasks: feature.tasks.map((t) => traceTask(commits, t)),
      },
    });
  }
  const requirement = feature.requirements.find((r) => r.id === id);
  if (requirement) return ok({ kind: "requirement", trace: traceRequirement(tree, commits, requirement) });
  const task = feature.tasks.find((t) => t.id === id);
  if (task) return ok({ kind: "task", trace: traceTask(commits, task) });
  return err({ kind: "not-found", message: `No requirement or task ${id} in feature ${name}` });
}

function traceRequirement(tree: SpecTree, commits: readonly TraceCommit[], requirement: Requirement): RequirementTrace {
  const key = fullRef(requirement.feature, requirement.id);
  const tasks = tree.features.flatMap((f) =>
    f.tasks
      .filter((t) => t.reqs.some((ref) => {
        const target = resolveRef(ref, f.name);
        return fullRef(target.feature, target.id) === key;
      }))
      .map(traced),
  );
  return {
    feature: requirement.feature,
    id: requirement.id,
    title: requirement.title,
    tasks,
    commits: commits.filter((c) => c.reqs.includes(key)),
  };
}

function traceTask(commits: readonly TraceCommit[], task: Task): TaskTrace {
  const key = fullRef(task.feature, task.id);
  return {
    ...traced(task),
    reqs: task.reqs.map((ref) => {
      const target = resolveRef(ref, task.feature);
      return fullRef(target.feature, target.id);
    }),
    commits: commits.filter((c) => c.tasks.includes(key)),
  };
}

function traced(task: Task): TracedTask {
  return { feature: task.feature, id: task.id, title: task.title, status: task.status };
}
