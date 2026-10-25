import type { Finding, SpecTree } from "../model.js";
import { dependencyCycle } from "./rules/dependency-cycle.js";
import { duplicateId } from "./rules/duplicate-id.js";
import { malformedHeading } from "./rules/malformed-heading.js";
import { orphanRequirement } from "./rules/orphan-requirement.js";
import { unknownRef } from "./rules/unknown-ref.js";

/** One lint rule. Rules are independent and only read the tree. */
export type LintRule = { id: string; check: (tree: SpecTree) => Finding[] };

/** Every rule, in the order they run. The order keeps output stable. */
export const lintRules: readonly LintRule[] = [
  malformedHeading,
  duplicateId,
  unknownRef,
  dependencyCycle,
  orphanRequirement,
];

/** Runs every lint rule over `tree`. Findings are grouped by rule, in rule order. */
export function lint(tree: SpecTree): Finding[] {
  return lintRules.flatMap((rule) => rule.check(tree));
}
