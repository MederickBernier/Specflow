import type { Git, GitError } from "../git.js";
import type { Finding, SpecTree } from "../model.js";
import { ok, type Result } from "../result.js";
import { buildDriftContext, type DriftRule } from "./context.js";
import { type LlmDeps, llmPass } from "./llm.js";
import { codeChangedSinceSpec } from "./rules/code-changed.js";
import { specChangedSinceCode } from "./rules/spec-changed.js";
import { unimplemented } from "./rules/unimplemented.js";
import { suppressAcked } from "./suppress.js";

/** The rule-based drift rules, in the order they run. The order keeps output stable (drift-check/R7). */
export const driftRules: readonly DriftRule[] = [codeChangedSinceSpec, specChangedSinceCode, unimplemented];

/**
 * Runs the rule-based drift pass: builds the context from git, runs every
 * rule, then drops acknowledged findings. `target` (`feature` or
 * `feature/R<n>`) limits the result. With `llm`, each remaining finding is
 * then reviewed by the harness (drift-check/R6); without it, no harness is
 * called.
 */
export async function checkDrift(
  git: Git,
  tree: SpecTree,
  options: { target?: string; llm?: LlmDeps } = {},
): Promise<Result<Finding[], GitError>> {
  const context = await buildDriftContext(git, tree);
  if (!context.ok) return context;
  const findings = driftRules.flatMap((rule) => rule.check(context.value));
  let kept = await suppressAcked(git, tree, findings);
  if (options.target) {
    const [feature, id] = options.target.split("/");
    kept = kept.filter((f) => f.feature === feature && (id === undefined || f.id === id));
  }
  return ok(options.llm ? await llmPass(options.llm, context.value, kept) : kept);
}
