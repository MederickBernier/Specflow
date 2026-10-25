import { fullRef, headingLocation } from "../../lint/refs.js";
import type { Finding } from "../../model.js";
import type { DriftRule } from "../context.js";

/**
 * drift-check/R2: the requirement's text changed after its newest trace
 * commit, and no commit referencing it came after. Approved requirements only.
 */
export const specChangedSinceCode: DriftRule = {
  id: "drift/spec-changed-since-code",
  check: ({ tree, index, specChanges }) => {
    const findings: Finding[] = [];
    for (const feature of tree.features) {
      for (const requirement of feature.requirements) {
        if (requirement.status !== "approved") continue;
        const key = fullRef(feature.name, requirement.id);
        const lastTrace = index.requirements.get(key)?.traceCommits[0];
        const spec = specChanges.get(key);
        if (!lastTrace || !spec) continue;
        const specAt = index.position.get(spec.hash);
        if (specAt === undefined || specAt >= index.position.get(lastTrace.hash)!) continue;
        findings.push({
          rule: "drift/spec-changed-since-code",
          severity: "warning",
          message: `${requirement.id} changed in ${spec.hash.slice(0, 7)} "${spec.subject}" and no commit referencing it came after`,
          location: headingLocation(requirement),
          feature: feature.name,
          id: requirement.id,
          evidence: { commit: spec.hash, subject: spec.subject },
        });
      }
    }
    return findings;
  },
};
