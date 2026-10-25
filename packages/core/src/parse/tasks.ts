import type { Finding, Task } from "../model.js";
import { isOneOf, type ParseOptions, splitItems, splitList } from "./items.js";

const statuses = ["todo", "doing", "done", "blocked"] as const;

/**
 * Parses one `tasks.md` into tasks, in source order.
 *
 * `reqs` comes from the heading's `[...]` list; a heading without one has no
 * references, the same as `[]`. `status`, `files` and `depends` map to
 * fields, with `files` and `depends` split on commas. A missing or
 * unrecognized status becomes `todo`, and the raw value is kept in `extra`,
 * as are all other metadata keys.
 */
export function parseTasks(markdown: string, options: ParseOptions): { tasks: Task[]; findings: Finding[] } {
  const { items, findings } = splitItems(markdown, options);

  const tasks = items.map((item): Task => {
    const extra: Record<string, string> = {};
    let status: Task["status"] = "todo";
    let files: string[] = [];
    let depends: string[] = [];

    for (const [key, value] of item.metadata) {
      if (key === "status" && isOneOf(statuses, value)) status = value;
      else if (key === "files") files = splitList(value);
      else if (key === "depends") depends = splitList(value);
      else extra[key] = value;
    }

    return {
      feature: options.feature,
      id: item.id,
      title: item.title,
      reqs: item.refs ?? [],
      status,
      files,
      depends,
      body: item.body,
      extra,
      location: item.location,
    };
  });

  return { tasks, findings };
}
