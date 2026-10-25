import { readTraceCommits, type TraceCommit, trace as traceTarget, type TracedTask } from "@specflow/core";
import { loadOrReport, table, writeJson } from "../output.js";
import { exitCodes, type Io } from "../program.js";

/** JSON schema ID of `specflow trace --json`. Bump the version on breaking changes. */
export const traceSchema = "specflow.trace/v1";

/** `specflow trace <feature>[/<id>]`: tasks and commits implementing the target, from git trailers. */
export async function traceCommand(io: Io, target: string, options: { json: boolean }): Promise<number> {
  const tree = await loadOrReport(io, traceSchema, options.json);
  if (typeof tree === "number") return tree;
  const fail = (kind: string, message: string) => {
    if (options.json) writeJson(io, { schema: traceSchema, error: { kind, message } });
    else io.stderr(`specflow: ${message}\n`);
    return exitCodes.failed;
  };

  const commits = await readTraceCommits(io.git, tree.root);
  if (!commits.ok) return fail("git-failed", commits.error.message);
  const result = traceTarget(tree, commits.value, target);
  if (!result.ok) return fail(result.error.kind, result.error.message);

  if (options.json) {
    writeJson(io, { schema: traceSchema, ...result.value });
    return exitCodes.ok;
  }

  const lines: string[] = [];
  const { value } = result;
  if (value.kind === "requirement") {
    lines.push(`${value.trace.feature}/${value.trace.id}: ${value.trace.title}`, "", "Tasks", tasksTable(value.trace.tasks));
    lines.push("", "Commits", ...commitLines(value.trace.commits));
  } else if (value.kind === "task") {
    const t = value.trace;
    lines.push(`${t.feature}/${t.id}: ${t.title} (${t.status})`, `Requirements: ${t.reqs.join(", ") || "none"}`);
    lines.push("", "Commits", ...commitLines(t.commits));
  } else {
    lines.push(value.trace.feature);
    for (const r of value.trace.requirements) {
      lines.push("", `${r.id}: ${r.title}`);
      lines.push(`  tasks: ${r.tasks.map((t) => `${t.feature}/${t.id} (${t.status})`).join(", ") || "none"}`);
      lines.push(...commitLines(r.commits));
    }
  }
  io.stdout(`${lines.join("\n")}\n`);
  return exitCodes.ok;
}

function tasksTable(tasks: TracedTask[]): string {
  return tasks.length === 0 ? "  none" : table(tasks.map((t) => [`${t.feature}/${t.id}`, t.status, t.title]));
}

function commitLines(commits: TraceCommit[]): string[] {
  if (commits.length === 0) return ["  no commits"];
  return commits.flatMap((c) => [
    `  ${c.hash.slice(0, 7)}  ${c.date.slice(0, 10)}  ${c.subject}`,
    ...c.files.map((f) => `      ${f.status[0]} ${f.from ? `${f.from} -> ` : ""}${f.path}`),
  ]);
}
