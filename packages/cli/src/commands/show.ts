import { type Feature, fullRef, type Requirement, resolveRef, type SpecTree, type Task } from "@specflow/core";
import { formatLocation, loadOrReport, relative, relativePath, table, writeJson } from "../output.js";
import { exitCodes, type Io } from "../program.js";

/** JSON schema ID of `specflow show --json`. Bump the version on breaking changes. */
export const showSchema = "specflow.show/v1";

/** `specflow show <feature>[/<id>]`: prints a feature, requirement or task; returns 1 when not found. */
export async function showCommand(io: Io, target: string, options: { json: boolean }): Promise<number> {
  const tree = await loadOrReport(io, showSchema, options.json);
  if (typeof tree === "number") return tree;

  const slash = target.indexOf("/");
  const featureName = slash === -1 ? target : target.slice(0, slash);
  const id = slash === -1 ? undefined : target.slice(slash + 1);
  const feature = tree.features.find((f) => f.name === featureName);

  const requirement = id === undefined ? undefined : feature?.requirements.find((r) => r.id === id);
  const task = id === undefined || requirement ? undefined : feature?.tasks.find((t) => t.id === id);

  if (!feature || (id !== undefined && !requirement && !task)) {
    const known = tree.features.map((f) => f.name).join(", ") || "none";
    const message = feature
      ? `No requirement or task ${id} in feature ${featureName}`
      : `No feature ${featureName}. Features: ${known}`;
    if (options.json) writeJson(io, { schema: showSchema, error: { kind: "not-found", message } });
    else io.stderr(`specflow: ${message}\n`);
    return exitCodes.failed;
  }

  if (requirement) showRequirement(io, tree, requirement, options.json);
  else if (task) showTask(io, tree, task, options.json);
  else showFeature(io, tree, feature, options.json);
  return exitCodes.ok;
}

function showFeature(io: Io, tree: SpecTree, feature: Feature, json: boolean): void {
  const dir = relativePath(tree.root, feature.dir);
  if (json) {
    writeJson(io, {
      schema: showSchema,
      kind: "feature",
      feature: {
        name: feature.name,
        dir,
        requirements: feature.requirements.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          ...(r.priority && { priority: r.priority }),
          location: relative(tree.root, r.location),
        })),
        tasks: feature.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          reqs: t.reqs,
          location: relative(tree.root, t.location),
        })),
        design: feature.design ? { location: relative(tree.root, feature.design.location) } : null,
      },
    });
    return;
  }

  const lines = [`${feature.name} (${dir})`, ""];
  lines.push("Requirements");
  lines.push(
    feature.requirements.length === 0
      ? "  none"
      : table(feature.requirements.map((r) => [r.id, r.status, r.priority ?? "-", r.title])),
  );
  lines.push("", "Tasks");
  lines.push(
    feature.tasks.length === 0
      ? "  none"
      : table(feature.tasks.map((t) => [t.id, t.status, `[${t.reqs.join(", ")}]`, t.title])),
  );
  lines.push("", `Design: ${feature.design ? formatLocation(relative(tree.root, feature.design.location)) : "none"}`);
  io.stdout(`${lines.join("\n")}\n`);
}

function showRequirement(io: Io, tree: SpecTree, requirement: Requirement, json: boolean): void {
  const key = fullRef(requirement.feature, requirement.id);
  const tasks = tree.features.flatMap((f) =>
    f.tasks.filter((t) => t.reqs.some((ref) => {
      const target = resolveRef(ref, f.name);
      return fullRef(target.feature, target.id) === key;
    })),
  );

  if (json) {
    writeJson(io, {
      schema: showSchema,
      kind: "requirement",
      requirement: { ...requirement, location: relative(tree.root, requirement.location) },
      tasks: tasks.map((t) => ({ feature: t.feature, id: t.id, title: t.title, status: t.status })),
    });
    return;
  }

  const lines = [`${key}: ${requirement.title}`];
  if (requirement.priority) lines.push(`priority: ${requirement.priority}`);
  lines.push(`status: ${requirement.status}`);
  for (const [k, v] of Object.entries(requirement.extra)) lines.push(`${k}: ${v}`);
  lines.push(`location: ${formatLocation(relative(tree.root, requirement.location))}`);
  if (requirement.body) lines.push("", requirement.body);
  lines.push("", "Tasks");
  lines.push(
    tasks.length === 0 ? "  none" : table(tasks.map((t) => [fullRef(t.feature, t.id), t.status, t.title])),
  );
  io.stdout(`${lines.join("\n")}\n`);
}

function showTask(io: Io, tree: SpecTree, task: Task, json: boolean): void {
  const requirements = task.reqs.map((ref) => {
    const target = resolveRef(ref, task.feature);
    const found = tree.features
      .find((f) => f.name === target.feature)
      ?.requirements.find((r) => r.id === target.id);
    return { ref, requirement: found };
  });

  if (json) {
    writeJson(io, {
      schema: showSchema,
      kind: "task",
      task: { ...task, location: relative(tree.root, task.location) },
      requirements: requirements.map(({ ref, requirement }) =>
        requirement
          ? { ref, feature: requirement.feature, id: requirement.id, title: requirement.title, status: requirement.status }
          : { ref, unknown: true },
      ),
    });
    return;
  }

  const lines = [`${fullRef(task.feature, task.id)}: ${task.title} [${task.reqs.join(", ")}]`];
  lines.push(`status: ${task.status}`);
  if (task.files.length > 0) lines.push(`files: ${task.files.join(", ")}`);
  if (task.depends.length > 0) lines.push(`depends: ${task.depends.join(", ")}`);
  for (const [k, v] of Object.entries(task.extra)) lines.push(`${k}: ${v}`);
  lines.push(`location: ${formatLocation(relative(tree.root, task.location))}`);
  if (task.body) lines.push("", task.body);
  lines.push("", "Requirements");
  lines.push(
    requirements.length === 0
      ? "  none"
      : table(
          requirements.map(({ ref, requirement }) =>
            requirement ? [ref, requirement.status, requirement.title] : [ref, "unknown", "-"],
          ),
        ),
  );
  io.stdout(`${lines.join("\n")}\n`);
}
