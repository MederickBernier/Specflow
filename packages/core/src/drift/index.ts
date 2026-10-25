import { matchesGlob } from "../glob.js";
import { fullRef, resolveRef } from "../lint/refs.js";
import type { SpecTree } from "../model.js";
import type { TraceCommit } from "../trace/commits.js";

/** What one requirement's trailers say about its implementation. */
export type RequirementIndex = {
  /** Commits whose trailers reference the requirement, newest first. */
  traceCommits: TraceCommit[];
  /** Files those commits touched that still exist, limited by the task plan (see the design's Attribution section). */
  touched: string[];
};

/** Everything the drift rules need from history, built from one `git log` (drift-check/R1, R4). */
export type DriftIndex = {
  /** Every commit, newest first. */
  commits: TraceCommit[];
  /** Index of each commit in `commits`; lower is newer. */
  position: Map<string, number>;
  /** By full requirement reference (`feature/R1`). Requirements without trace commits have empty lists. */
  requirements: Map<string, RequirementIndex>;
  /** Commits touching each file, newest first. Files matching `drift.ignore` or under the specs folder are left out. */
  fileHistory: Map<string, TraceCommit[]>;
};

/** Builds the drift index from `history`, as returned by `readHistory` (newest first). */
export function buildDriftIndex(tree: SpecTree, history: readonly TraceCommit[]): DriftIndex {
  const specsPrefix = `${tree.config.specsDir.replace(/\/$/, "")}/`;
  const ignored = (path: string) =>
    path.startsWith(specsPrefix) || tree.config.drift.ignore.some((pattern) => matchesGlob(path, pattern));

  const position = new Map(history.map((commit, index) => [commit.hash, index]));

  const fileHistory = new Map<string, TraceCommit[]>();
  for (const commit of history) {
    for (const file of commit.files) {
      if (ignored(file.path)) continue;
      const list = fileHistory.get(file.path) ?? [];
      list.push(commit);
      fileHistory.set(file.path, list);
    }
  }

  const requirements = new Map<string, RequirementIndex>();
  for (const feature of tree.features) {
    for (const requirement of feature.requirements) {
      const key = fullRef(feature.name, requirement.id);
      // The task plan: patterns of every task referencing the requirement. A task without files does not restrict.
      const tasks = tree.features.flatMap((f) =>
        f.tasks.filter((t) => t.reqs.some((ref) => {
          const target = resolveRef(ref, f.name);
          return fullRef(target.feature, target.id) === key;
        })),
      );
      const unrestricted = tasks.length === 0 || tasks.some((t) => t.files.length === 0);
      const patterns = tasks.flatMap((t) => t.files);
      const planned = (path: string) => unrestricted || patterns.some((pattern) => matchesGlob(path, pattern));

      const traceCommits = history.filter((commit) => commit.reqs.includes(key));
      requirements.set(key, { traceCommits, touched: touchedSet(history, traceCommits, (p) => !ignored(p) && planned(p)) });
    }
  }

  return { commits: [...history], position, requirements, fileHistory };
}

// Replays history oldest first: trace commits add their files, later deletions
// remove them, and renames carry them to the new path.
function touchedSet(
  history: readonly TraceCommit[],
  traceCommits: readonly TraceCommit[],
  counts: (path: string) => boolean,
): string[] {
  const trace = new Set(traceCommits.map((c) => c.hash));
  const touched = new Set<string>();
  for (let i = history.length - 1; i >= 0; i--) {
    const commit = history[i]!;
    for (const file of commit.files) {
      const kind = file.status[0];
      if (kind === "D") {
        touched.delete(file.path);
      } else if (kind === "R" && file.from !== undefined && touched.has(file.from)) {
        touched.delete(file.from);
        if (counts(file.path)) touched.add(file.path);
      } else if (trace.has(commit.hash) && counts(file.path)) {
        touched.add(file.path);
      }
    }
  }
  return [...touched].sort();
}
