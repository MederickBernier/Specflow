import type { LintRule } from "../lint.js";
import { fullRef, headingLocation, resolveRef } from "../refs.js";

/** A task referencing a requirement that does not exist, in its own feature or the one named in the reference. */
export const unknownRef: LintRule = {
  id: "unknown-ref",
  check: (tree) => {
    const known = new Set(tree.features.flatMap((f) => f.requirements.map((r) => fullRef(f.name, r.id))));
    return tree.features.flatMap((feature) =>
      feature.tasks.flatMap((task) =>
        task.reqs
          .filter((ref) => {
            const target = resolveRef(ref, feature.name);
            return !known.has(fullRef(target.feature, target.id));
          })
          .map((ref) => ({
            rule: "unknown-ref",
            severity: "error" as const,
            message: `Task ${task.id} references unknown requirement ${ref}`,
            location: headingLocation(task),
            feature: feature.name,
            id: task.id,
          })),
      ),
    );
  },
};
