import { fullRef, headingLocation } from "../../lint/refs.js";
import type { Finding } from "../../model.js";
import type { DriftRule } from "../context.js";

/**
 * drift-check/R1: a file the requirement's trace commits touched changed
 * later in a commit that does not reference the requirement, and the
 * requirement's text has not changed since. One finding per file, naming the
 * newest such commit. Approved requirements only.
 */
export const codeChangedSinceSpec: DriftRule = {
  id: "drift/code-changed-since-spec",
  check: ({ tree, index, specChanges }) => {
    const findings: Finding[] = [];
    for (const feature of tree.features) {
      for (const requirement of feature.requirements) {
        if (requirement.status !== "approved") continue;
        const key = fullRef(feature.name, requirement.id);
        const entry = index.requirements.get(key);
        const lastTrace = entry?.traceCommits[0];
        if (!entry || !lastTrace) continue;

        const traced = index.position.get(lastTrace.hash)!;
        const spec = specChanges.get(key);
        const specAt = spec ? (index.position.get(spec.hash) ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;

        for (const file of entry.touched) {
          // Newest first: the first commit newer than the last trace commit, not referencing
          // the requirement, and not followed by a spec change.
          const offending = (index.fileHistory.get(file) ?? []).find((commit) => {
            const at = index.position.get(commit.hash)!;
            return at < traced && !commit.reqs.includes(key) && !(specAt < at);
          });
          if (!offending) continue;
          findings.push({
            rule: "drift/code-changed-since-spec",
            severity: "warning",
            message: `${file} changed in ${offending.hash.slice(0, 7)} "${offending.subject}" after ${requirement.id} was last implemented, and ${requirement.id}'s text has not changed since`,
            location: headingLocation(requirement),
            feature: feature.name,
            id: requirement.id,
            evidence: { file, commit: offending.hash, subject: offending.subject },
          });
        }
      }
    }
    return findings;
  },
};
