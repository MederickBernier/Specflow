import type { FileSystem } from "../fs.js";
import type { Git, GitError } from "../git.js";
import { joinPath } from "../paths.js";
import { err, ok, type Result } from "../result.js";
import { type FileDiff, parseUnifiedDiff } from "./unified.js";

/**
 * Size limits (workbench-ui/R4): a file with more changed lines, or more
 * patch text, is returned as `tooLarge` without hunks; once the response
 * reaches `totalBytes`, the remaining files are left out and `truncated` is set.
 */
export const diffLimits = { fileLines: 5_000, fileBytes: 1_000_000, totalBytes: 10_000_000 };

/** Files of a diff, and whether some were left out to stay within {@link diffLimits}. */
export type DiffResult = { files: FileDiff[]; truncated: boolean };

/** The tree of a repository without commits, to diff against when there is no HEAD. */
export const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// The patch format the parser expects, whatever the user's config says.
const patchArgs = ["--no-color", "--no-ext-diff", "--no-textconv", "-M", "-U3", "--src-prefix=a/", "--dst-prefix=b/"];

/**
 * Uncommitted changes under `root` against `HEAD`, staged or not, including
 * untracked files (not ignored ones), as `git diff HEAD` sees them plus the
 * untracked files read through `fs`. Nothing is added to the index. Paths are
 * relative to `root`; `paths` narrows the diff to those files.
 */
export async function readWorkingDiff(
  git: Git,
  fs: FileSystem,
  root: string,
  options: { paths?: string[]; limits?: typeof diffLimits } = {},
): Promise<Result<DiffResult, GitError>> {
  const limits = options.limits ?? diffLimits;
  const run = (args: string[]) => git.run(args, { cwd: root });
  const pathspec = (options.paths ?? []).map((path) => `:(literal)${path}`);
  const head = await run(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  const base = head.ok ? "HEAD" : emptyTree;

  const tracked = await readPatch(run, ["diff", base, "--relative"], pathspec, limits);
  if (!tracked.ok) return tracked;
  const untracked = await run(["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspec]);
  if (!untracked.ok) return untracked;

  const files = tracked.value.files;
  let bytes = tracked.value.bytes;
  let truncated = tracked.value.truncated;
  for (const path of untracked.value.split("\0").filter(Boolean)) {
    if (truncated) break;
    const added = await untrackedFile(fs, joinPath(root, path), path, limits).catch(() => undefined);
    // Deleted since git listed it.
    if (!added) continue;
    if (added.bytes + bytes > limits.totalBytes) {
      truncated = true;
      break;
    }
    bytes += added.bytes;
    files.push(added.file);
  }
  return ok({ files: files.sort(byPath), truncated });
}

/**
 * The changes a commit made, as `git show` prints them; a root commit is
 * diffed against the empty tree. Paths are relative to the repository's top
 * level. `commit` must be a hash, not an option or revision expression.
 */
export async function readCommitDiff(
  git: Git,
  root: string,
  commit: string,
  options: { limits?: typeof diffLimits } = {},
): Promise<Result<DiffResult, GitError>> {
  if (!/^[0-9a-f]{4,64}$/.test(commit)) {
    return err({ args: ["show", commit], exitCode: null, stderr: "", message: `Not a commit hash: ${commit}` });
  }
  const run = (args: string[]) => git.run(args, { cwd: root });
  const result = await readPatch(run, ["show", "--format=", commit], [], options.limits ?? diffLimits);
  return result.ok ? ok({ files: result.value.files, truncated: result.value.truncated }) : result;
}

type Run = (args: string[]) => Promise<Result<string, GitError>>;

// Counts changed lines per file first, so files over the line limit are
// never read, then reads the patch of the others and applies the byte limits.
async function readPatch(
  run: Run,
  command: string[],
  pathspec: string[],
  limits: typeof diffLimits,
): Promise<Result<{ files: FileDiff[]; bytes: number; truncated: boolean }, GitError>> {
  const numstat = await run([...command, "--numstat", "-z", "-M", "--", ...pathspec]);
  if (!numstat.ok) return numstat;
  const large = parseNumstat(numstat.value).filter((entry) => entry.added + entry.deleted > limits.fileLines);
  const exclude = large.flatMap((entry) => [entry.path, ...(entry.from ? [entry.from] : [])]).map((path) => `:(exclude,literal)${path}`);
  // An exclude-only pathspec would match nothing on old git; "." keeps it relative to the command's scope.
  const narrowed = exclude.length > 0 ? [...(pathspec.length > 0 ? pathspec : ["."]), ...exclude] : pathspec;
  const patch = await run([...command, ...patchArgs, "--", ...narrowed]);
  if (!patch.ok) return patch;

  const files: FileDiff[] = [];
  let bytes = 0;
  let truncated = false;
  for (const { text, file } of splitPatch(patch.value)) {
    const size = new TextEncoder().encode(text).length;
    const kept = size > limits.fileBytes ? placeholder(file) : file;
    const cost = kept.tooLarge ? 0 : size;
    if (bytes + cost > limits.totalBytes) {
      truncated = true;
      break;
    }
    bytes += cost;
    files.push(kept);
  }
  for (const entry of large) {
    files.push({
      path: entry.path,
      ...(entry.from && { from: entry.from }),
      change: entry.from ? "renamed" : "modified",
      binary: false,
      additions: entry.added,
      deletions: entry.deleted,
      hunks: [],
      tooLarge: true,
    });
  }
  return ok({ files: files.sort(byPath), bytes, truncated });
}

function byPath(a: FileDiff, b: FileDiff): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

type NumstatEntry = { added: number; deleted: number; path: string; from?: string };

// `added\tdeleted\tpath\0`, or `added\tdeleted\t\0from\0to\0` for a rename; binary files count `-`.
function parseNumstat(output: string): NumstatEntry[] {
  const tokens = output.split("\0");
  const entries: NumstatEntry[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(tokens[i]!);
    if (!match) continue;
    const counts = { added: match[1] === "-" ? 0 : Number(match[1]), deleted: match[2] === "-" ? 0 : Number(match[2]) };
    if (match[3] === "") {
      entries.push({ ...counts, from: tokens[i + 1]!, path: tokens[i + 2]! });
      i += 2;
    } else {
      entries.push({ ...counts, path: match[3]! });
    }
  }
  return entries;
}

// Each file's section of the patch with its parsed diff, so limits apply per file.
function splitPatch(patch: string): { text: string; file: FileDiff }[] {
  const starts: number[] = [];
  if (patch.startsWith("diff --git ")) starts.push(0);
  for (let at = patch.indexOf("\ndiff --git "); at !== -1; at = patch.indexOf("\ndiff --git ", at + 1)) starts.push(at + 1);
  return starts.flatMap((start, n) => {
    const text = patch.slice(start, starts[n + 1] ?? patch.length);
    return parseUnifiedDiff(text).map((file) => ({ text, file }));
  });
}

function placeholder(file: FileDiff): FileDiff {
  return { ...file, hunks: [], tooLarge: true };
}

async function untrackedFile(fs: FileSystem, absolute: string, path: string, limits: typeof diffLimits): Promise<{ file: FileDiff; bytes: number }> {
  const base: FileDiff = { path, change: "added", binary: false, additions: 0, deletions: 0, hunks: [] };
  const size = await fs.size(absolute);
  if (size > limits.fileBytes) return { file: { ...base, tooLarge: true }, bytes: 0 };
  const content = await fs.readFile(absolute);
  if (content.includes("\0")) return { file: { ...base, binary: true }, bytes: 0 };
  if (content === "") return { file: base, bytes: 0 };
  const lines = content.split("\n");
  const noNewline = lines.at(-1) !== "";
  if (!noNewline) lines.pop();
  if (lines.length > limits.fileLines) return { file: { ...base, additions: lines.length, tooLarge: true }, bytes: 0 };
  const hunkLines = lines.map((text, index) => ({
    kind: "add" as const,
    text: text.endsWith("\r") ? text.slice(0, -1) : text,
    newLine: index + 1,
    ...(noNewline && index === lines.length - 1 && { noNewline: true as const }),
  }));
  return {
    file: { ...base, additions: lines.length, hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: hunkLines }] },
    bytes: size,
  };
}
