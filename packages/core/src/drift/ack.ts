import type { FileSystem } from "../fs.js";
import type { Git } from "../git.js";
import { resolveRef } from "../lint/refs.js";
import { setMetadataLine } from "../metadata.js";
import type { SpecTree } from "../model.js";
import { parseRequirements } from "../parse/requirements.js";
import { joinPath } from "../paths.js";
import { err, ok, type Result } from "../result.js";

/** What {@link ackDrift} wrote: the requirement, its file, the full hash, and the hash it replaced. */
export type DriftAck = { feature: string; id: string; file: string; commit: string; previous?: string };

/** Why nothing was written. */
export type AckError = { kind: "unknown-requirement" | "unknown-commit"; message: string };

/**
 * Acknowledges drift on a requirement (workbench-ui/R7, drift-check/R5):
 * sets its `drift-ack:` line to the full hash of `commit`, inserting the line
 * after the heading if missing and changing no other line. Nothing is
 * written for an unknown requirement or a commit git cannot resolve. It
 * never commits; that stays with the human.
 */
export async function ackDrift(
  fs: FileSystem,
  git: Git,
  tree: SpecTree,
  ref: string,
  commit: string,
): Promise<Result<DriftAck, AckError>> {
  const slash = ref.lastIndexOf("/");
  const target = slash === -1 ? undefined : resolveRef(ref, "");
  const unknown = err<AckError>({ kind: "unknown-requirement", message: `No requirement ${ref}; use feature/R<n>, such as auth/R3` });
  if (!target?.feature || !target.id) return unknown;
  const feature = tree.features.find((f) => f.name === target.feature);
  if (!feature) return unknown;
  const file = joinPath(feature.dir, "requirements.md");
  if (!(await fs.exists(file))) return unknown;

  // The file is read again, since it may have changed since the tree loaded.
  const text = await fs.readFile(file);
  const requirement = parseRequirements(text, { file, feature: feature.name, prefix: tree.config.ids.requirement }).requirements.find((r) => r.id === target.id);
  if (!requirement) return unknown;

  // --end-of-options keeps a value such as --output=x from being read as an option.
  const resolved = await git.run(["rev-parse", "--verify", "--quiet", "--end-of-options", `${commit}^{commit}`], { cwd: tree.root });
  if (!resolved.ok || !/^[0-9a-f]{40,64}$/.test(resolved.value.trim())) {
    return err({ kind: "unknown-commit", message: `${commit} is not a commit in this repository` });
  }
  const hash = resolved.value.trim();

  const edited = setMetadataLine(text, requirement.location.startLine, "drift-ack", hash);
  await fs.writeFile(file, edited.text);
  const previous = requirement.extra["drift-ack"]?.trim();
  return ok({ feature: feature.name, id: requirement.id, file, commit: hash, ...(previous && { previous }) });
}

