import { checkDrift, type HarnessAdapter } from "@specflow/core";
import { formatLocation, loadOrReport, relative, writeJson } from "../output.js";
import { exitCodes, type Io } from "../program.js";

/** JSON schema ID of `specflow drift --json`. Bump the version on breaking changes. */
export const driftSchema = "specflow.drift/v1";

const severityRank = { info: 0, warning: 1, error: 2 } as const;

/**
 * `specflow drift [<feature>[/<id>]]`: the rule-based drift pass, plus the
 * harness review when `llm` is set or `drift.llm` is true. Exits 0 unless
 * `failOn` is set and a finding is at least that severe, for CI.
 */
export async function driftCommand(
  io: Io,
  target: string | undefined,
  options: { json: boolean; llm: boolean; failOn?: "warning" | "error" },
): Promise<number> {
  const tree = await loadOrReport(io, driftSchema, options.json);
  if (typeof tree === "number") return tree;
  const fail = (kind: string, message: string) => {
    if (options.json) writeJson(io, { schema: driftSchema, error: { kind, message } });
    else io.stderr(`specflow: ${message}\n`);
    return exitCodes.unusable;
  };

  let llm: { adapter: HarnessAdapter; fs: Io["fs"] } | undefined;
  if (options.llm || tree.config.drift.llm) {
    const adapter = io.registry.resolve(tree.config);
    if (!adapter.ok) return fail(adapter.error.kind, adapter.error.message);
    const check = await adapter.value.check();
    if (!check.ok) return fail("harness-unavailable", `The LLM pass needs ${adapter.value.name}: ${check.error.message}`);
    llm = { adapter: adapter.value, fs: io.fs };
  }

  const result = await checkDrift(io.git, tree, { ...(target && { target }), ...(llm && { llm }) });
  if (!result.ok) return fail("git-failed", result.error.message);

  const findings = result.value.map((f) => ({ ...f, location: relative(tree.root, f.location) }));
  const count = (severity: string) => findings.filter((f) => f.severity === severity).length;
  const summary = { errors: count("error"), warnings: count("warning"), infos: count("info") };

  if (options.json) {
    writeJson(io, { schema: driftSchema, root: tree.root, summary, findings });
  } else if (findings.length === 0) {
    io.stdout("No drift found.\n");
  } else {
    for (const f of findings) {
      io.stdout(`${formatLocation(f.location)}: ${f.severity} ${f.rule}: ${f.message}\n`);
      if (f.verdict) io.stdout(`  verdict: ${f.verdict.verdict}: ${f.verdict.reason}\n`);
    }
    io.stdout(`\n${findings.length} finding${findings.length === 1 ? "" : "s"}. Acknowledge one with a drift-ack: <commit> line on the requirement.\n`);
  }

  const threshold = options.failOn ? severityRank[options.failOn] : Number.POSITIVE_INFINITY;
  return findings.some((f) => severityRank[f.severity] >= threshold) ? exitCodes.failed : exitCodes.ok;
}
