import type { Git } from "../git.js";
import type { Finding, SpecTree } from "../model.js";

/**
 * drift-check/R5: drops findings a human acknowledged with `drift-ack: <hash>`
 * on the requirement. A finding is suppressed when the commit that caused it
 * is the acked commit or one of its ancestors, so a newer change reports
 * again. A finding with no causing commit (`unimplemented`) is suppressed by
 * any drift-ack that names a real commit. An unknown hash suppresses nothing.
 */
export async function suppressAcked(git: Git, tree: SpecTree, findings: readonly Finding[]): Promise<Finding[]> {
  const acks = new Map<string, string>();
  for (const feature of tree.features) {
    for (const requirement of feature.requirements) {
      const ack = requirement.extra["drift-ack"]?.trim();
      if (ack) acks.set(`${feature.name}/${requirement.id}`, ack);
    }
  }
  if (acks.size === 0) return [...findings];

  const cache = new Map<string, boolean>();
  const isAncestor = async (commit: string, ack: string): Promise<boolean> => {
    const key = `${commit}..${ack}`;
    if (!cache.has(key)) {
      const result = await git.run(["merge-base", "--is-ancestor", commit, ack], { cwd: tree.root });
      cache.set(key, result.ok);
    }
    return cache.get(key)!;
  };
  const exists = async (ack: string) => (await git.run(["rev-parse", "--verify", "--quiet", `${ack}^{commit}`], { cwd: tree.root })).ok;

  const kept: Finding[] = [];
  for (const finding of findings) {
    const ack = acks.get(`${finding.feature}/${finding.id}`);
    const commit = finding.evidence?.commit;
    const suppressed = ack !== undefined && (commit ? await isAncestor(commit, ack) : await exists(ack));
    if (!suppressed) kept.push(finding);
  }
  return kept;
}
