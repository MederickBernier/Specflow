import type { Location, Requirement, SpecTree, Task } from "@specflow/core";

/** One node of the spec explorer, independent of the VS Code API so it can be unit tested. */
export type ExplorerNode = {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  /** A codicon name. */
  icon: string;
  /** Where clicking the node goes. */
  location?: Location;
  /** For menus: `root`, `feature`, `requirement`, `task` or `error`. */
  kind: "root" | "feature" | "requirement" | "task" | "error";
  children: ExplorerNode[];
};

/** A loaded root, or one that failed to load. */
export type ExplorerSource = { root: string; name: string; tree?: SpecTree; error?: string };

export const taskIcons: Record<Task["status"], string> = {
  todo: "circle-large-outline",
  doing: "sync",
  done: "pass",
  blocked: "circle-slash",
};

export const requirementIcons: Record<Requirement["status"], string> = {
  approved: "verified",
  draft: "edit",
  removed: "trash",
};

/**
 * The explorer's top-level nodes: the features of a single root, or one node
 * per root when there are several. Requirements come before tasks.
 */
export function explorerNodes(sources: readonly ExplorerSource[]): ExplorerNode[] {
  const perRoot = sources.map((source) => rootChildren(source));
  if (sources.length === 1) return perRoot[0]!;
  return sources.map((source, i) => ({
    id: source.root,
    label: source.name,
    tooltip: source.root,
    icon: "root-folder",
    kind: "root",
    children: perRoot[i]!,
  }));
}

function rootChildren(source: ExplorerSource): ExplorerNode[] {
  if (!source.tree) {
    return [
      {
        id: `${source.root}#error`,
        label: "Specs could not be loaded",
        description: source.error,
        tooltip: source.error,
        icon: "error",
        kind: "error",
        children: [],
      },
    ];
  }
  return source.tree.features.map((feature) => {
    const done = feature.tasks.filter((t) => t.status === "done").length;
    const children: ExplorerNode[] = [
      ...feature.requirements.map((r) => requirementNode(source.root, r)),
      ...feature.tasks.map((t) => taskNode(source.root, t)),
    ];
    return {
      id: `${source.root}#${feature.name}`,
      label: feature.name,
      description: `${feature.requirements.length} req · ${done}/${feature.tasks.length} done`,
      icon: "folder",
      kind: "feature",
      ...(feature.requirements[0] && { location: { ...feature.requirements[0].location, startLine: 1, endLine: 1 } }),
      children,
    };
  });
}

function requirementNode(root: string, r: Requirement): ExplorerNode {
  return {
    id: `${root}#${r.feature}/${r.id}`,
    label: `${r.id}: ${r.title}`,
    description: [r.status, r.priority].filter(Boolean).join(" · "),
    tooltip: `${r.feature}/${r.id} (${r.status})`,
    icon: requirementIcons[r.status],
    location: r.location,
    kind: "requirement",
    children: [],
  };
}

function taskNode(root: string, t: Task): ExplorerNode {
  return {
    id: `${root}#${t.feature}/${t.id}`,
    label: `${t.id}: ${t.title}`,
    description: [t.status, t.reqs.length > 0 ? t.reqs.join(", ") : undefined].filter(Boolean).join(" · "),
    tooltip: `${t.feature}/${t.id} (${t.status})${t.files.length > 0 ? `\n${t.files.join("\n")}` : ""}`,
    icon: taskIcons[t.status],
    location: t.location,
    kind: "task",
    children: [],
  };
}
