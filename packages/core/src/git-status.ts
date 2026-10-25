import type { Git, GitError } from "./git.js";
import type { Result } from "./result.js";

/** One line of `git status --porcelain`: two-letter code, path, and the old path of a rename or copy. */
export type StatusEntry = { code: string; path: string; from?: string };

/** Parses `git status --porcelain=v1 -z` output. Paths are relative to the repo's top level. */
export function parseStatus(output: string): StatusEntry[] {
  const tokens = output.split("\0");
  const entries: StatusEntry[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.length < 4) continue;
    const code = token.slice(0, 2);
    const entry: StatusEntry = { code, path: token.slice(3) };
    // Renames and copies are followed by their source path.
    if (code[0] === "R" || code[0] === "C") entry.from = tokens[++i];
    entries.push(entry);
  }
  return entries;
}

/**
 * Uncommitted changes, untracked files included, under `cwd` and matching
 * `pathspec` (for example `[".", ":(exclude).specs"]`).
 */
export async function gitStatus(
  git: Git,
  cwd: string,
  pathspec: string[] = [],
): Promise<Result<StatusEntry[], GitError>> {
  const result = await git.run(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...pathspec], { cwd });
  return result.ok ? { ok: true, value: parseStatus(result.value) } : result;
}
