import type { FileSystem } from "../fs.js";
import { fullRef, resolveRef } from "../lint/refs.js";
import type { Location, Requirement, SpecTree } from "../model.js";
import { joinPath } from "../paths.js";
import { err, ok, type Result } from "../result.js";

/** Why a prompt could not be built. */
export type PromptError = {
  kind: "unknown-task" | "unknown-requirement";
  message: string;
};

/**
 * Builds the prompt sent to the harness for one task: the steering files
 * (`product.md`, `tech.md`), the task's own text, the full text of each
 * requirement it references, its feature's `design.md`, the feature's other
 * open tasks marked out of scope, and the instructions: this task only, no
 * spec edits (specflow owns the status line), and spec notes at the end.
 * Nothing from other features is included, except requirements the task
 * references there explicitly (`other/R1`).
 *
 * Item text is copied from the source files by line range, so the harness
 * sees exactly what is written. Missing steering or design files and empty
 * sections are left out.
 */
export async function buildTaskPrompt(
  fs: FileSystem,
  tree: SpecTree,
  target: { feature: string; task: string },
): Promise<Result<string, PromptError>> {
  const feature = tree.features.find((f) => f.name === target.feature);
  const task = feature?.tasks.find((t) => t.id === target.task);
  if (!feature || !task) {
    return err({ kind: "unknown-task", message: `No task ${fullRef(target.feature, target.task)}` });
  }

  const requirements: Requirement[] = [];
  for (const ref of task.reqs) {
    const { feature: name, id } = resolveRef(ref, feature.name);
    const requirement = tree.features.find((f) => f.name === name)?.requirements.find((r) => r.id === id);
    if (!requirement) {
      return err({
        kind: "unknown-requirement",
        message: `Task ${fullRef(feature.name, task.id)} references unknown requirement ${ref}`,
      });
    }
    requirements.push(requirement);
  }

  const files = new Map<string, string[]>();
  const source = async (location: Location): Promise<string> => {
    let lines = files.get(location.file);
    if (!lines) {
      lines = (await fs.readFile(location.file)).replace(/\r\n?/g, "\n").split("\n");
      files.set(location.file, lines);
    }
    return lines.slice(location.startLine - 1, location.endLine).join("\n");
  };

  const specsDir = joinPath(tree.root, tree.config.specsDir);
  const steering: string[] = [];
  for (const name of ["product.md", "tech.md"]) {
    const path = joinPath(specsDir, name);
    if (await fs.exists(path)) steering.push((await fs.readFile(path)).replace(/\r\n?/g, "\n").trim());
  }

  const sections: string[] = [];
  if (steering.length > 0) sections.push(block("steering", steering.join("\n\n")));
  sections.push(block(`task id="${fullRef(feature.name, task.id)}"`, await source(task.location)));
  if (requirements.length > 0) {
    const texts = await Promise.all(
      requirements.map(async (r) => block(`requirement id="${fullRef(r.feature, r.id)}"`, await source(r.location))),
    );
    sections.push(block("requirements", texts.join("\n\n")));
  }
  if (feature.design) sections.push(block("design", feature.design.markdown.replace(/\r\n?/g, "\n").trim()));

  const open = feature.tasks.filter((t) => t.id !== task.id && t.status !== "done");
  if (open.length > 0) {
    const list = open.map((t) => `- ${t.id}: ${t.title}`).join("\n");
    sections.push(block("out-of-scope", `Other open tasks in this feature, each done in its own run:\n${list}`));
  }

  sections.push(
    [
      "Work on this task only; leave the out-of-scope tasks for their own runs.",
      `Do not edit files under ${tree.config.specsDir}/; specflow updates this task's status.`,
      "If the design cannot work as written, stop and explain why.",
      'If you found problems in the spec or made decisions it does not cover, end your final reply with a "Spec notes:" section listing them as bullets.',
    ].join("\n"),
  );

  return ok(`${sections.join("\n\n")}\n`);
}

function block(tag: string, content: string): string {
  const name = tag.split(" ")[0]!;
  return `<${tag}>\n${content.trim()}\n</${name}>`;
}
