import type { FileSystem } from "../fs.js";
import { fullRef } from "../lint/refs.js";
import type { Finding, SpecTree } from "../model.js";
import { joinPath } from "../paths.js";
import type { HarnessAdapter } from "../run/adapter.js";
import type { RunEvent } from "../run/events.js";
import type { DriftContext } from "./context.js";

type Verdict = NonNullable<Finding["verdict"]>;

/** What the LLM pass needs from its shell. */
export type LlmDeps = { adapter: HarnessAdapter; fs: FileSystem };

/**
 * drift-check/R6: asks the harness, once per finding, whether the current
 * code still satisfies the requirement's acceptance criteria, and attaches
 * the answer as `verdict`. The prompt is read-only; a harness that changes a
 * file anyway is aborted and the verdict is `unsure`. A malformed answer is
 * `unsure` with the raw text as the reason. Never fails the whole check.
 */
export async function llmPass(
  deps: LlmDeps,
  context: DriftContext,
  findings: readonly Finding[],
): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const finding of findings) {
    const prompt = await llmPrompt(deps.fs, context, finding);
    out.push({ ...finding, verdict: prompt === undefined ? unsure("Requirement not found") : await ask(deps.adapter, context.tree, prompt) });
  }
  return out;
}

/** The read-only prompt for one finding, or undefined when its requirement is gone. */
export async function llmPrompt(fs: FileSystem, context: DriftContext, finding: Finding): Promise<string | undefined> {
  const { tree, index } = context;
  const requirement = tree.features.find((f) => f.name === finding.feature)?.requirements.find((r) => r.id === finding.id);
  if (!requirement) return undefined;

  const touched = index.requirements.get(fullRef(finding.feature, requirement.id))?.touched ?? [];
  let budget = tree.config.drift.llmBytes;
  const files: string[] = [];
  for (const file of touched) {
    const path = joinPath(tree.root, file);
    if (budget <= 0 || !(await fs.exists(path))) continue;
    const content = await fs.readFile(path);
    const bytes = Buffer.from(content, "utf8");
    const shown = bytes.length > budget ? `${bytes.subarray(0, budget).toString("utf8")}\n[truncated]` : content;
    budget -= Math.min(bytes.length, budget);
    files.push(`<file path="${file}">\n${shown.trimEnd()}\n</file>`);
  }

  const criteria = requirement.criteria.map((c) => `- ${c.keyword} ${c.text}`).join("\n");
  return [
    `<requirement id="${fullRef(requirement.feature, requirement.id)}">`,
    `## ${requirement.id}: ${requirement.title}`,
    requirement.body.trim(),
    "</requirement>",
    "",
    `<criteria>\n${criteria || "(none listed)"}\n</criteria>`,
    "",
    `<finding>\n${finding.message}\n</finding>`,
    "",
    files.length > 0 ? `<code>\n${files.join("\n")}\n</code>` : "<code>\n(no files)\n</code>",
    "",
    "Does the code above still satisfy every acceptance criterion of the requirement?",
    "This is a review only: do not edit, create or delete any file, and do not run commands that change anything.",
    'Answer with one JSON object and nothing else: {"verdict": "holds" | "broken" | "unsure", "reason": "<one or two sentences>"}',
    "",
  ].join("\n");
}

async function ask(adapter: HarnessAdapter, tree: SpecTree, prompt: string): Promise<Verdict> {
  const controller = new AbortController();
  const events: RunEvent[] = [];
  let edited: string | undefined;
  try {
    const input = { cwd: tree.root, prompt, extraArgs: tree.config.harness.adapters[adapter.name]?.extraArgs ?? [] };
    for await (const event of adapter.run(input, controller.signal)) {
      events.push(event);
      if (event.kind === "file-changed" && edited === undefined) {
        edited = event.path;
        controller.abort();
      }
    }
  } catch (error) {
    return unsure(`The harness failed: ${(error as Error).message}`);
  }
  if (edited !== undefined) return unsure(`The harness changed ${edited} during a read-only review, so the run was aborted`);

  const finished = events.findLast((e) => e.kind === "finished");
  const message = events.findLast((e) => e.kind === "message");
  const answer = (finished?.kind === "finished" && finished.summary) || (message?.kind === "message" ? message.text : "");
  if (finished?.kind === "finished" && !finished.ok && !answer) return unsure("The harness run failed");
  return parseVerdict(answer);
}

/** Reads `{"verdict": ..., "reason": ...}` from an answer, also inside a code fence. Anything else is `unsure`. */
export function parseVerdict(answer: string): Verdict {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const value: unknown = JSON.parse(answer.slice(start, end + 1));
      if (typeof value === "object" && value !== null && "verdict" in value) {
        const { verdict, reason } = value as { verdict: unknown; reason?: unknown };
        if (verdict === "holds" || verdict === "broken" || verdict === "unsure") {
          return { verdict, reason: typeof reason === "string" ? reason.trim() : "" };
        }
      }
    } catch {
      // Falls through to unsure below.
    }
  }
  const raw = answer.trim();
  return unsure(raw ? `Unreadable answer: ${raw.slice(0, 500)}` : "Empty answer");
}

function unsure(reason: string): Verdict {
  return { verdict: "unsure", reason };
}
