// Edits one `key: value` line in the metadata block under an item's heading,
// changing no other line. Lines keep their `\r`, so joining with `\n`
// reproduces the file exactly.

const metadataLine = /^([a-z][a-z-]*):\s*(.*)$/;

/** Where an item's metadata lives: the last line of its heading, and the `key:` line if it has one (0-based). */
export type MetadataPosition = { headingEnd: number; index?: number };

/** Finds `key:` in the metadata block of the item whose heading starts on `startLine` (1-based). */
export function findMetadataLine(lines: readonly string[], startLine: number, key: string): MetadataPosition {
  let headingEnd = startLine - 1;
  // A setext heading's underline is part of the heading.
  if (/^\s{0,3}(-+|=+)\s*$/.test(content(lines[headingEnd + 1] ?? "")) && !/^\s{0,3}#/.test(lines[headingEnd]!)) {
    headingEnd++;
  }
  for (let i = headingEnd + 1; i < lines.length; i++) {
    const meta = metadataLine.exec(content(lines[i]!));
    if (!meta) break;
    if (meta[1] === key) return { headingEnd, index: i };
  }
  return { headingEnd };
}

/**
 * Sets `key:` of the item whose heading starts on `startLine` to `value`,
 * keeping the key's spacing and any trailing whitespace, or inserts
 * `key: value` right after the heading. Returns the new text and the line
 * as it was (without its `\r`), or null when there was none.
 */
export function setMetadataLine(text: string, startLine: number, key: string, value: string): { text: string; previous: string | null } {
  const lines = text.split("\n");
  const { headingEnd, index } = findMetadataLine(lines, startLine, key);
  if (index === undefined) {
    lines.splice(headingEnd + 1, 0, `${key}: ${value}${ending(lines[headingEnd]!)}`);
    return { text: lines.join("\n"), previous: null };
  }
  const line = lines[index]!;
  const previous = content(line);
  const [, prefix, , trailing] = new RegExp(`^(${key}:\\s*)(.*?)(\\s*)$`).exec(previous)!;
  lines[index] = `${prefix === `${key}:` ? `${key}: ` : prefix}${value}${trailing}${ending(line)}`;
  return { text: lines.join("\n"), previous };
}

/**
 * Puts `key:` back exactly as `line` (as returned by {@link setMetadataLine}),
 * or removes it when `line` is null. Undefined when there is no `key:` line
 * to put back, which means the file changed in between.
 */
export function restoreMetadataLine(text: string, startLine: number, key: string, line: string | null): string | undefined {
  const lines = text.split("\n");
  const { index } = findMetadataLine(lines, startLine, key);
  if (index === undefined) return line === null ? text : undefined;
  if (line === null) lines.splice(index, 1);
  else lines[index] = line + ending(lines[index]!);
  return lines.join("\n");
}

function content(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function ending(line: string): string {
  return line.endsWith("\r") ? "\r" : "";
}
