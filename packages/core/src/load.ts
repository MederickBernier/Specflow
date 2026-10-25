import { posix } from "node:path";
import { type ConfigError, loadConfig } from "./config.js";
import type { FileSystem } from "./fs.js";
import type { Feature, SpecTree } from "./model.js";
import { parseRequirements } from "./parse/requirements.js";
import { parseTasks } from "./parse/tasks.js";
import { err, ok, type Result } from "./result.js";

/** Why a spec tree could not be loaded. */
export type LoadError =
  | { kind: "no-specs"; from: string; message: string }
  | { kind: "invalid-config"; config: ConfigError; message: string }
  | { kind: "missing-specs-dir"; path: string; message: string };

/**
 * Finds the repo root: the nearest directory at or above `from` that
 * contains `.specs/`. The search stops at a directory containing `.git`, so a
 * repo without specs never picks up a parent repo's. Returns undefined when
 * there is no root.
 */
export async function findRoot(fs: FileSystem, from: string): Promise<string | undefined> {
  let dir = posix.normalize(from);
  for (;;) {
    if (await fs.exists(posix.join(dir, ".specs"))) return dir;
    if (await fs.exists(posix.join(dir, ".git"))) return undefined;
    const parent = posix.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Loads the whole spec tree for the repo containing `from`: config, then
 * every non-hidden folder under the specs directory as a feature, in
 * folder-name order. Each of `requirements.md`, `tasks.md` and `design.md`
 * is optional. Parse findings are kept on each feature.
 */
export async function loadSpecTree(fs: FileSystem, from: string): Promise<Result<SpecTree, LoadError>> {
  const root = await findRoot(fs, from);
  if (root === undefined) {
    return err({ kind: "no-specs", from, message: `No .specs/ folder found at or above ${from}` });
  }

  const config = await loadConfig(fs, root);
  if (!config.ok) {
    return err({ kind: "invalid-config", config: config.error, message: config.error.message });
  }

  const specsDir = posix.join(root, config.value.specsDir);
  if (!(await fs.exists(specsDir))) {
    return err({
      kind: "missing-specs-dir",
      path: specsDir,
      message: `specsDir "${config.value.specsDir}" from .specs/config.yml does not exist: ${specsDir}`,
    });
  }

  const names = (await fs.listDir(specsDir, { directoriesOnly: true })).filter((name) => !name.startsWith("."));
  const { requirement, task } = config.value.ids;
  const features = await Promise.all(
    names.map((name) => loadFeature(fs, posix.join(specsDir, name), name, { requirement, task })),
  );

  return ok({ root, config: config.value, features });
}

async function loadFeature(
  fs: FileSystem,
  dir: string,
  name: string,
  prefixes: { requirement: string; task: string },
): Promise<Feature> {
  const [requirementsText, tasksText, designText] = await Promise.all(
    ["requirements.md", "tasks.md", "design.md"].map((file) => readIfExists(fs, posix.join(dir, file))),
  );

  const requirementsFile = posix.join(dir, "requirements.md");
  const tasksFile = posix.join(dir, "tasks.md");
  const designFile = posix.join(dir, "design.md");

  const requirements =
    requirementsText === undefined
      ? { requirements: [], findings: [] }
      : parseRequirements(requirementsText, { file: requirementsFile, feature: name, prefix: prefixes.requirement });
  const tasks =
    tasksText === undefined
      ? { tasks: [], findings: [] }
      : parseTasks(tasksText, { file: tasksFile, feature: name, prefix: prefixes.task });

  return {
    name,
    dir,
    requirements: requirements.requirements,
    tasks: tasks.tasks,
    ...(designText !== undefined && {
      design: { markdown: designText, location: { file: designFile, startLine: 1, endLine: lineCount(designText) } },
    }),
    findings: [...requirements.findings, ...tasks.findings],
  };
}

async function readIfExists(fs: FileSystem, path: string): Promise<string | undefined> {
  return (await fs.exists(path)) ? fs.readFile(path) : undefined;
}

// Number of the last non-blank line, at least 1.
function lineCount(text: string): number {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 1 && lines.at(-1)!.trim() === "") lines.pop();
  return lines.length;
}
