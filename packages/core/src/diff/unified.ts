/** One line of a hunk. `oldLine` and `newLine` are 1-based; context lines have both. */
export type DiffLine = {
  kind: "context" | "add" | "del";
  text: string;
  oldLine?: number;
  newLine?: number;
  /** The line is the last of its file and has no newline after it (`\ No newline at end of file`). */
  noNewline?: true;
};

/** One `@@ -a,b +c,d @@` block. `section` is the function or heading git printed after it, if any. */
export type DiffHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; section?: string; lines: DiffLine[] };

/**
 * One file of a patch. `path` is the new path (the old one for a deletion),
 * relative to where git ran; `from` is the old path of a rename. A binary
 * file has no hunks; neither has one marked `tooLarge`, whose patch was not
 * read or parsed (workbench-ui/R4).
 */
export type FileDiff = {
  path: string;
  from?: string;
  change: "added" | "modified" | "deleted" | "renamed";
  binary: boolean;
  oldMode?: string;
  newMode?: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  tooLarge?: true;
};

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/**
 * Parses git's patch format, as printed by `git diff` or `git show` with
 * `a/` and `b/` prefixes. Handles renames, mode changes, binary files,
 * `\ No newline at end of file`, CRLF line endings and quoted paths
 * (`core.quotePath`). Hunk lines are read by the counts in their header, so
 * content that looks like a header is never mistaken for one.
 */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (lines.at(-1) === "") lines.pop();
  const files: FileDiff[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i]!.startsWith("diff --git ")) {
      i++;
      continue;
    }
    const [a, b] = gitHeaderPaths(lines[i]!.slice("diff --git ".length));
    const file: FileDiff = { path: b ?? a ?? "", change: "modified", binary: false, additions: 0, deletions: 0, hunks: [] };
    let oldPath = a;
    i++;
    // Extended header lines, up to the first hunk or the next file.
    for (; i < lines.length && !lines[i]!.startsWith("diff --git ") && !lines[i]!.startsWith("@@ "); i++) {
      const line = lines[i]!;
      if (line.startsWith("new file mode ")) {
        file.change = "added";
        file.newMode = line.slice("new file mode ".length);
      } else if (line.startsWith("deleted file mode ")) {
        file.change = "deleted";
        file.oldMode = line.slice("deleted file mode ".length);
      } else if (line.startsWith("old mode ")) file.oldMode = line.slice("old mode ".length);
      else if (line.startsWith("new mode ")) file.newMode = line.slice("new mode ".length);
      else if (line.startsWith("rename from ") || line.startsWith("copy from ")) {
        oldPath = unquotePath(line.slice(line.indexOf(" from ") + " from ".length));
        file.change = line.startsWith("rename") ? "renamed" : "added";
      } else if (line.startsWith("rename to ") || line.startsWith("copy to ")) {
        file.path = unquotePath(line.slice(line.indexOf(" to ") + " to ".length));
      } else if (line.startsWith("--- ")) {
        const path = patchPath(line.slice(4), "a/");
        if (path !== undefined) oldPath = path;
      } else if (line.startsWith("+++ ")) {
        const path = patchPath(line.slice(4), "b/");
        if (path !== undefined) file.path = path;
      } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
        file.binary = true;
      }
    }
    if (file.change === "deleted" && oldPath !== undefined) file.path = oldPath;
    else if (oldPath !== undefined && oldPath !== file.path && file.change !== "added") {
      file.from = oldPath;
      file.change = "renamed";
    } else if (file.change === "added" && oldPath !== undefined && oldPath !== file.path) {
      file.from = oldPath;
    }

    while (i < lines.length && lines[i]!.startsWith("@@ ")) {
      const match = hunkHeader.exec(lines[i]!);
      i++;
      if (!match) continue;
      const hunk: DiffHunk = {
        oldStart: Number(match[1]),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        ...(match[5] && { section: match[5] }),
        lines: [],
      };
      let oldLine = hunk.oldStart;
      let newLine = hunk.newStart;
      let oldLeft = hunk.oldLines;
      let newLeft = hunk.newLines;
      while (i < lines.length && (oldLeft > 0 || newLeft > 0 || lines[i]!.startsWith("\\"))) {
        const line = lines[i]!;
        const mark = line[0];
        if (mark === "\\") {
          const last = hunk.lines.at(-1);
          if (last) last.noNewline = true;
        } else if (mark === "+" && newLeft > 0) {
          hunk.lines.push({ kind: "add", text: line.slice(1), newLine: newLine++ });
          newLeft--;
          file.additions++;
        } else if (mark === "-" && oldLeft > 0) {
          hunk.lines.push({ kind: "del", text: line.slice(1), oldLine: oldLine++ });
          oldLeft--;
          file.deletions++;
        } else if ((mark === " " || line === "") && oldLeft > 0 && newLeft > 0) {
          // Some tools strip the space of an empty context line.
          hunk.lines.push({ kind: "context", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
          oldLeft--;
          newLeft--;
        } else {
          break;
        }
        i++;
      }
      file.hunks.push(hunk);
    }
    files.push(file);
  }
  return files;
}

/**
 * Undoes git's C-style quoting of a path (`"a/\303\251.txt"`): backslash
 * escapes and octal bytes, decoded as UTF-8. An unquoted path is returned as is.
 */
export function unquotePath(text: string): string {
  if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) return text;
  const bytes: number[] = [];
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  const encoder = new TextEncoder();
  for (let i = 1; i < text.length - 1; i++) {
    const char = text[i]!;
    if (char !== "\\") {
      bytes.push(...encoder.encode(char));
      continue;
    }
    const next = text[++i]!;
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(text.slice(i, i + 3), 8));
      i += 2;
    } else {
      bytes.push(escapes[next] ?? next.charCodeAt(0));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// The two paths of `diff --git a/x b/y`, prefixes removed. Unquoted paths
// with spaces are ambiguous; the halves are equal unless the file was
// renamed, and a rename names its paths again in `rename from/to`.
function gitHeaderPaths(rest: string): [string | undefined, string | undefined] {
  const tokens: string[] = [];
  let i = 0;
  while (i < rest.length && tokens.length < 2) {
    if (rest[i] === " ") {
      i++;
      continue;
    }
    if (rest[i] === '"') {
      let j = i + 1;
      while (j < rest.length && rest[j] !== '"') j += rest[j] === "\\" ? 2 : 1;
      tokens.push(unquotePath(rest.slice(i, j + 1)));
      i = j + 1;
    } else if (tokens.length === 0 && !rest.includes('"')) {
      // Both unquoted: split in the middle when the halves match, else at " b/".
      const half = (rest.length - 1) / 2;
      const split = Number.isInteger(half) && rest.slice(2, half) === rest.slice(half + 3) ? half : rest.lastIndexOf(" b/");
      tokens.push(rest.slice(0, split), rest.slice(split + 1));
      break;
    } else {
      const end = tokens.length === 0 ? rest.indexOf(' "', i) : rest.length;
      tokens.push(rest.slice(i, end === -1 ? rest.length : end));
      i = end === -1 ? rest.length : end;
    }
  }
  const strip = (token: string | undefined, prefix: string) => (token?.startsWith(prefix) ? token.slice(prefix.length) : token);
  return [strip(tokens[0], "a/"), strip(tokens[1], "b/")];
}

// A `---` or `+++` path: undefined for /dev/null. Git appends a tab to names
// that contain a space.
function patchPath(text: string, prefix: string): string | undefined {
  const name = text.startsWith('"') ? unquotePath(text) : text.endsWith("\t") ? text.slice(0, -1) : text;
  if (name === "/dev/null") return undefined;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}
