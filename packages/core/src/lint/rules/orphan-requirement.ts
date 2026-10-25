import type { LintRule } from "../lint.js";
import { fullRef, headingLocation, resolveRef } from "../refs.js";

/** An approved requirement that no task, in any feature, references. */
export const orphanRequirement: LintRule = {
  id: "orphan-requirement",
  check: (tree) => {
    const referenced = new Set(
      tree.features.flatMap((feature) =>
        feature.tasks.flatMap((task) =>
          task.reqs.map((ref) => resolveRef(ref, feature.name)).map((t) => fullRef(t.feature, t.id)),
        ),
      ),
    );
    return tree.features.flatMap((feature) =>
      feature.requirements
        .filter((r) => r.status === "approved" && !referenced.has(fullRef(feature.name, r.id)))
        .map((r) => ({
          rule: "orphan-requirement",
          severity: "warning" as const,
          message: `Approved requirement ${r.id} has no task`,
          location: headingLocation(r),
          feature: feature.name,
          id: r.id,
        })),
    );
  },
};
