import { fullRef, headingLocation, resolveRef } from "../../lint/refs.js";
import type { Finding } from "../../model.js";
import type { DriftRule } from "../context.js";

/**
 * drift-check/R3: an approved requirement whose tasks are all done but which
 * no commit references, so its trailers were missed.
 */
export const unimplemented: DriftRule = {
  id: "drift/unimplemented",
  check: ({ tree, index }) => {
    const findings: Finding[] = [];
    for (const feature of tree.features) {
      for (const requirement of feature.requirements) {
        if (requirement.status !== "approved") continue;
        const key = fullRef(feature.name, requirement.id);
        const tasks = tree.features.flatMap((f) =>
          f.tasks.filter((t) => t.reqs.some((ref) => {
            const target = resolveRef(ref, f.name);
            return fullRef(target.feature, target.id) === key;
          })),
        );
        if (tasks.length === 0 || tasks.some((t) => t.status !== "done")) continue;
        if ((index.requirements.get(key)?.traceCommits.length ?? 0) > 0) continue;
        findings.push({
          rule: "drift/unimplemented",
          severity: "warning",
          message: `${requirement.id} has all its tasks done (${tasks.map((t) => fullRef(t.feature, t.id)).join(", ")}) but no commit references it; trailers were probably missed`,
          location: headingLocation(requirement),
          feature: feature.name,
          id: requirement.id,
        });
      }
    }
    return findings;
  },
};
