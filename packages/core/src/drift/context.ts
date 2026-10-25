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

/** How many `git log -L` lookups run at once. Each is one git process. */
export const specHistoryConcurrency = 8;

/**
 * Reads history once and the spec history of every traced requirement.
 * The `git log -L` lookups run concurrently (drift-check/R8); results are
 * keyed by requirement, so output does not depend on their order.
 */
export async function buildDriftContext(git: Git, tree: SpecTree): Promise<Result<DriftContext, GitError>> {
  const history = await readHistory(git, tree.root);
  if (!history.ok) return history;
  const index = buildDriftIndex(tree, history.value);

  const traced = tree.features.flatMap((feature) =>
    feature.requirements
      .map((requirement) => ({ key: fullRef(feature.name, requirement.id), requirement }))
      .filter(({ key }) => (index.requirements.get(key)?.traceCommits.length ?? 0) > 0),
  );

  const specChanges = new Map<string, SpecChange | undefined>();
  const headFiles = new Map<string, Promise<Result<string, GitError>>>();
  let next = 0;
  let failure: GitError | undefined;
  const worker = async () => {
    while (next < traced.length && !failure) {
      const { key, requirement } = traced[next++]!;
      const change = await lastSpecChange(git, tree, requirement, headFiles);
      if (change.ok) specChanges.set(key, change.value);
      else failure ??= change.error;
    }
  };
  await Promise.all(Array.from({ length: Math.min(specHistoryConcurrency, traced.length) }, worker));
  if (failure) return err(failure);
  return ok({ tree, index, specChanges });
}

/** A drift rule: reads the context, never changes anything. */
export type DriftRule = { id: string; check: (context: DriftContext) => Finding[] };

