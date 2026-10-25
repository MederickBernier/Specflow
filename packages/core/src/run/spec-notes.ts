/** A final reply split into what the agent did and the spec changes it suggests. */
export type SplitReply = { summary: string; notes: string[] };

// "Spec notes:", "## Spec notes", "**Spec notes:**", optionally with the first note on the same line.
const heading = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?spec notes(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*(.*)$/i;
const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

/**
 * Splits a final reply at its first `Spec notes:` line (task-run/R12).
 * `notes` are the bullet items after it, with continuation lines joined;
 * `summary` is the text before it. Without such a line, `notes` is empty and
 * `summary` is the whole reply.
 */
export function extractSpecNotes(text: string): SplitReply {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return { summary: text.trim(), notes: [] };

  const notes: string[] = [];
  const inline = heading.exec(lines[start]!)![1]!.trim();
  if (inline !== "" && !/^none\.?$/i.test(inline)) notes.push(inline);
  for (const line of lines.slice(start + 1)) {
    const item = bullet.exec(line);
    if (item) {
      notes.push(item[1]!.trim());
    } else if (line.trim() !== "" && notes.length > 0) {
      notes[notes.length - 1] += ` ${line.trim()}`;
    }
  }
  return { summary: lines.slice(0, start).join("\n").trim(), notes: notes.filter((n) => !/^none\.?$/i.test(n)) };
}

/** The commit body for a run summary (task-run/R6): its first paragraph, without spec notes. */
export function commitBody(summary: string | undefined): string | undefined {
  if (summary === undefined) return undefined;
  const first = extractSpecNotes(summary).summary.split(/\n\s*\n/)[0]?.trim();
  return first ? first : undefined;
}
