import type { LintRule } from "../lint.js";

/** Headings that look like IDs but do not parse. Detected by the parsers and kept on each feature. */
export const malformedHeading: LintRule = {
  id: "malformed-heading",
  check: (tree) => tree.features.flatMap((feature) => feature.findings.filter((f) => f.rule === "malformed-heading")),
};
