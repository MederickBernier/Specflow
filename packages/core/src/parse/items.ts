import type { Heading, Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Finding, Location } from "../model.js";

/** A level 2 heading with an ID, plus everything up to the next level 2 heading. */
export type RawItem = {
  /** ID as written, prefix included: `R3`. */
  id: string;
  title: string;
  /** Contents of the heading's trailing `[...]` list, or undefined when there is none. */
  refs?: string[];
  /** Metadata lines in source order. A repeated key keeps its last value. */
  metadata: Map<string, string>;
  body: string;
  /** Top-level markdown nodes after the metadata lines. */
  nodes: RootContent[];
  location: Location;
};

/** Options shared by the requirements and tasks parsers. */
export type ParseOptions = {
  /** Path recorded in every location. */
  file: string;
  /** Feature folder name. */
  feature: string;
  /** ID prefix from config, for example `R` or `T`. */
  prefix: string;
};

const metadataLine = /^([a-z][a-z-]*):\s*(.*)$/;

/**
 * Splits a requirements or tasks file into items. A level 2 heading whose
 * text starts with the prefix and a digit but does not parse produces a
 * `malformed-heading` finding and is skipped. `source` is the input with
 * line endings normalized, which node offsets refer to.
 */
export function splitItems(
  markdown: string,
  options: ParseOptions,
): { items: RawItem[]; findings: Finding[]; source: string } {
  const source = markdown.replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const root: Root = fromMarkdown(source);
  const prefix = escapeRegExp(options.prefix);
  const idHeading = new RegExp(`^(${prefix})(\\d+):\\s*(.+?)(?:\\s*\\[([^\\]]*)\\])?$`);
  const looksLikeId = new RegExp(`^${prefix}\\d`);

  const headings = root.children
    .map((node, index) => ({ node, index }))
    .filter((entry): entry is { node: Heading; index: number } => entry.node.type === "heading" && entry.node.depth === 2);

  const items: RawItem[] = [];
  const findings: Finding[] = [];

  headings.forEach(({ node: heading, index }, n) => {
    const next = headings[n + 1];
    const startLine = heading.position!.start.line;
    const headingEndLine = heading.position!.end.line;
    const lastLine = next ? next.node.position!.start.line - 1 : lines.length;
    const endLine = lastNonBlank(lines, headingEndLine, lastLine);
    const text = inlineSource(heading, source);
    const location: Location = { file: options.file, startLine, endLine };

    const match = idHeading.exec(text);
    if (!match) {
      if (looksLikeId.test(text)) {
        findings.push({
          rule: "malformed-heading",
          severity: "error",
          message: `Heading "${text}" looks like an ID but does not match "## ${options.prefix}<n>: <title>"`,
          location: { file: options.file, startLine, endLine: headingEndLine },
          feature: options.feature,
        });
      }
      return;
    }

    const metadata = new Map<string, string>();
    let metadataEndLine = headingEndLine;
    for (let line = headingEndLine + 1; line <= endLine; line++) {
      const meta = metadataLine.exec(lines[line - 1]!);
      if (!meta) break;
      metadata.set(meta[1]!, meta[2]!.trim());
      metadataEndLine = line;
    }

    const nodes = root.children
      .slice(index + 1, next ? next.index : undefined)
      .filter((node) => node.position!.end.line > metadataEndLine);

    items.push({
      id: `${match[1]}${match[2]}`,
      title: match[3]!,
      ...(match[4] !== undefined && { refs: splitList(match[4]) }),
      metadata,
      body: lines.slice(metadataEndLine, endLine).join("\n").replace(/^\n+/, ""),
      nodes,
      location,
    });
  });

  return { items, findings, source };
}

/** Splits a comma-separated value, dropping empty entries. */
export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Raw markdown of a node's inline content, whitespace collapsed. */
export function inlineSource(node: { children: RootContent[] | Heading["children"] }, source: string): string {
  const first = node.children[0]?.position?.start.offset;
  const last = node.children.at(-1)?.position?.end.offset;
  if (first === undefined || last === undefined) return "";
  return source.slice(first, last).replace(/\s+/g, " ").trim();
}

function lastNonBlank(lines: string[], from: number, to: number): number {
  let line = to;
  while (line > from && lines[line - 1]!.trim() === "") line--;
  return line;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
