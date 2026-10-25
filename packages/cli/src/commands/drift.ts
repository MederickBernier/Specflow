import { checkDrift } from "@specflow/core";
import { formatLocation, loadOrReport, relative, writeJson } from "../output.js";
import { exitCodes, type Io } from "../program.js";

/** JSON schema ID of `specflow drift --json`. Bump the version on breaking changes. */
export const driftSchema = "specflow.drift/v1";

const severityRank = { info: 0, warning: 1, error: 2 } as const;

/**
 * `specflow drift [<feature>[/<id>]]`: the rule-based drift pass. Exits 0
 * unless `failOn` is set and a finding is at least that severe, for CI.
 */
export async function driftCommand(
  io: Io,
  target: string | undefined,
  options: { json: boolean; failOn?: "warning" | "error" },
): Promise<number> {
  const tree = await loadOrReport(io, driftSchema, options.json);
  if (typeof tree === "number") return tree;

  const result = await checkDrift(io.git, tree, target ? { target } : {});
  if (!result.ok) {
    if (options.json) writeJson(io, { schema: driftSchema, error: { kind: "git-failed", message: result.error.message } });
    else io.stderr(`specflow: ${result.error.message}\n`);
    return exitCodes.unusable;
  }

  const findings = result.value.map((f) => ({ ...f, location: relative(tree.root, f.location) }));
  const count = (severity: string) => findings.filter((f) => f.severity === severity).length;
  const summary = { errors: count("error"), warnings: count("warning"), infos: count("info") };

  if (options.json) {
    writeJson(io, { schema: driftSchema, root: tree.root, summary, findings });
  } else if (findings.length === 0) {
    io.stdout("No drift found.\n");
  } else {
    for (const f of findings) io.stdout(`${formatLocation(f.location)}: ${f.severity} ${f.rule}: ${f.message}\n`);
    io.stdout(`\n${findings.length} finding${findings.length === 1 ? "" : "s"}. Acknowledge one with a drift-ack: <commit> line on the requirement.\n`);
  }

  const threshold = options.failOn ? severityRank[options.failOn] : Number.POSITIVE_INFINITY;
  return findings.some((f) => severityRank[f.severity] >= threshold) ? exitCodes.failed : exitCodes.ok;
}
