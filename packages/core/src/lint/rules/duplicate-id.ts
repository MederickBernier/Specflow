import type { Finding, Requirement, Task } from "../../model.js";
import type { LintRule } from "../lint.js";
import { headingLocation } from "../refs.js";

/** An ID used more than once in one feature. Every use after the first is reported. */
export const duplicateId: LintRule = {
  id: "duplicate-id",
  check: (tree) =>
    tree.features.flatMap((feature) => [
      ...duplicates(feature.requirements, "requirement"),
      ...duplicates(feature.tasks, "task"),
    ]),
};

function duplicates(items: (Requirement | Task)[], kind: string): Finding[] {
  const first = new Map<string, Requirement | Task>();
  const findings: Finding[] = [];
  for (const item of items) {
    const original = first.get(item.id);
    if (original === undefined) {
      first.set(item.id, item);
      continue;
    }
    findings.push({
      rule: "duplicate-id",
      severity: "error",
      message: `Duplicate ${kind} ID ${item.id} in ${item.feature}, first defined on line ${original.location.startLine}`,
      location: headingLocation(item),
      feature: item.feature,
      id: item.id,
    });
  }
  return findings;
}
