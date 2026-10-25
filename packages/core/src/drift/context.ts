import type { Git, GitError } from "../git.js";
import { fullRef } from "../lint/refs.js";
import type { Finding, SpecTree } from "../model.js";
import { err, ok, type Result } from "../result.js";
import { readHistory } from "../trace/commits.js";
import { buildDriftIndex, type DriftIndex } from "./index.js";
import { lastSpecChange, type SpecChange } from "./spec-history.js";

/** Everything the drift rules read. Built once per check. */
export type DriftContext = {
  tree: SpecTree;
  index: DriftIndex;
  /** Last spec change per requirement (`feature/R1`), only for requirements with trace commits. */
  specChanges: Map<string, SpecChange | undefined>;
};

/** Reads history once and the spec history of every traced requirement. */
export async function buildDriftContext(git: Git, tree: SpecTree): Promise<Result<DriftContext, GitError>> {
  const history = await readHistory(git, tree.root);
  if (!history.ok) return history;
  const index = buildDriftIndex(tree, history.value);

  const specChanges = new Map<string, SpecChange | undefined>();
  for (const feature of tree.features) {
    for (const requirement of feature.requirements) {
      const key = fullRef(feature.name, requirement.id);
      if ((index.requirements.get(key)?.traceCommits.length ?? 0) === 0) continue;
      const change = await lastSpecChange(git, tree, requirement);
      if (!change.ok) return err(change.error);
      specChanges.set(key, change.value);
    }
  }
  return ok({ tree, index, specChanges });
}

/** A drift rule: reads the context, never changes anything. */
export type DriftRule = { id: string; check: (context: DriftContext) => Finding[] };

