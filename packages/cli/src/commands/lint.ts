import { lint } from "@specflow/core";
import { formatLocation, loadOrReport, relative, writeJson } from "../output.js";
import { exitCodes, type Io } from "../program.js";

/** JSON schema ID of `specflow lint --json`. Bump the version on breaking changes. */
export const lintSchema = "specflow.lint/v1";

/** `specflow lint`: prints findings and returns 1 when any finding is an error. */
export async function lintCommand(io: Io, options: { json: boolean }): Promise<number> {
  const tree = await loadOrReport(io, lintSchema, options.json);
  if (typeof tree === "number") return tree;

  const findings = lint(tree).map((finding) => ({ ...finding, location: relative(tree.root, finding.location) }));
  const count = (severity: string) => findings.filter((f) => f.severity === severity).length;
  const summary = { errors: count("error"), warnings: count("warning"), infos: count("info") };

  if (options.json) {
    writeJson(io, { schema: lintSchema, root: tree.root, summary, findings });
  } else if (findings.length === 0) {
    io.stdout("No problems found.\n");
  } else {
    for (const f of findings) {
      io.stdout(`${formatLocation(f.location)}: ${f.severity} ${f.rule}: ${f.message}\n`);
    }
    io.stdout(`\n${plural(summary.errors, "error")}, ${plural(summary.warnings, "warning")}\n`);
  }

  return summary.errors > 0 ? exitCodes.failed : exitCodes.ok;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
