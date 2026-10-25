import type { List } from "mdast";
import type { Criterion, Finding, Requirement } from "../model.js";
import { inlineSource, isOneOf, type ParseOptions, splitItems } from "./items.js";

const priorities = ["must", "should", "could"] as const;
const statuses = ["draft", "approved", "removed"] as const;
const criterionLine = /^(given|when|then|and)\b\s*(.*)$/i;

/**
 * Parses one `requirements.md` into requirements, in source order.
 *
 * `priority` and `status` map to fields. A missing or unrecognized status
 * becomes `draft` and an unrecognized priority is left unset; in both cases
 * the raw value is kept in `extra`, as are all other metadata keys.
 */
export function parseRequirements(
  markdown: string,
  options: ParseOptions,
): { requirements: Requirement[]; findings: Finding[] } {
  const { items, findings, source } = splitItems(markdown, options);

  const requirements = items.map((item): Requirement => {
    const extra: Record<string, string> = {};
    let priority: Requirement["priority"];
    let status: Requirement["status"] = "draft";

    for (const [key, value] of item.metadata) {
      if (key === "priority" && isOneOf(priorities, value)) priority = value;
      else if (key === "status" && isOneOf(statuses, value)) status = value;
      else extra[key] = value;
    }

    return {
      feature: options.feature,
      id: item.id,
      title: item.title,
      ...(priority && { priority }),
      status,
      body: item.body,
      criteria: item.nodes
        .filter((node): node is List => node.type === "list")
        .flatMap((list) => list.children)
        .flatMap((listItem): Criterion[] => {
          const first = listItem.children[0];
          if (first?.type !== "paragraph") return [];
          const match = criterionLine.exec(inlineSource(first, source));
          if (!match) return [];
          return [{ keyword: capitalize(match[1]!) as Criterion["keyword"], text: match[2]! }];
        }),
      extra,
      location: item.location,
    };
  });

  return { requirements, findings };
}

function capitalize(word: string): string {
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}
