import type { Location, Requirement, Task } from "../model.js";

/** Resolves `R3` against `feature`, or `other/R3` against `other`. */
export function resolveRef(ref: string, feature: string): { feature: string; id: string } {
  const slash = ref.lastIndexOf("/");
  return slash === -1 ? { feature, id: ref } : { feature: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

/** Full reference `feature/id`. */
export function fullRef(feature: string, id: string): string {
  return `${feature}/${id}`;
}

/** The heading line of an item, which is where its findings point. */
export function headingLocation(item: Requirement | Task): Location {
  return { ...item.location, endLine: item.location.startLine };
}
