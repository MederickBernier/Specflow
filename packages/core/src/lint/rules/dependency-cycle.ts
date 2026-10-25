import type { Finding, Task } from "../../model.js";
import type { LintRule } from "../lint.js";
import { fullRef, headingLocation, resolveRef } from "../refs.js";

/**
 * Tasks whose `depends` lines form a cycle, across features too. One finding
 * per cycle, on its first task in tree order. Unknown dependencies are ignored.
 */
export const dependencyCycle: LintRule = {
  id: "dependency-cycle",
  check: (tree) => {
    const tasks = new Map<string, Task>();
    for (const feature of tree.features) {
      for (const task of feature.tasks) {
        if (!tasks.has(fullRef(feature.name, task.id))) tasks.set(fullRef(feature.name, task.id), task);
      }
    }
    const order = [...tasks.keys()];
    const edges = new Map(
      order.map((key) => {
        const task = tasks.get(key)!;
        const targets = task.depends
          .map((ref) => resolveRef(ref, task.feature))
          .map((target) => fullRef(target.feature, target.id))
          .filter((target) => tasks.has(target));
        return [key, [...new Set(targets)]];
      }),
    );

    const findings: Finding[] = [];
    for (const component of stronglyConnected(order, edges)) {
      const start = order.find((key) => component.has(key))!;
      const isCycle = component.size > 1 || edges.get(start)!.includes(start);
      if (!isCycle) continue;
      const task = tasks.get(start)!;
      findings.push({
        rule: "dependency-cycle",
        severity: "error",
        message: `Dependency cycle: ${cyclePath(start, component, edges).join(" -> ")}`,
        location: headingLocation(task),
        feature: task.feature,
        id: task.id,
      });
    }
    return findings.sort((a, b) => order.indexOf(fullRef(a.feature, a.id!)) - order.indexOf(fullRef(b.feature, b.id!)));
  },
};

// Tarjan's algorithm, iterating nodes and edges in the given order so output is stable.
function stronglyConnected(nodes: string[], edges: Map<string, string[]>): Set<string>[] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: Set<string>[] = [];
  let counter = 0;

  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    for (const next of edges.get(node)!) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component = new Set<string>();
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.add(member);
      } while (member !== node);
      components.push(component);
    }
  };

  for (const node of nodes) {
    if (!index.has(node)) visit(node);
  }
  return components;
}

// A path from `start` back to itself inside `component`, found depth first.
function cyclePath(start: string, component: Set<string>, edges: Map<string, string[]>): string[] {
  const path = [start];
  const seen = new Set([start]);
  const walk = (node: string): boolean => {
    for (const next of edges.get(node)!) {
      if (next === start) {
        path.push(start);
        return true;
      }
      if (component.has(next) && !seen.has(next)) {
        seen.add(next);
        path.push(next);
        if (walk(next)) return true;
        path.pop();
      }
    }
    return false;
  };
  walk(start);
  return path;
}
