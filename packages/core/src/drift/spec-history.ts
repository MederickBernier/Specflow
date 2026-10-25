import type { Git, GitError } from "../git.js";
import type { Requirement, SpecTree } from "../model.js";
import { parseRequirements } from "../parse/requirements.js";
import { toPosixPath } from "../paths.js";
import { err, ok, type Result } from "../result.js";
import { normalizeDate } from "../trace/commits.js";

/** The commit that last changed a requirement's text. */
export type SpecChange = { hash: string; date: string; subject: string };

const recordSeparator = "\x1e";

/**
 * The last commit that changed `requirement`'s text (drift-check/R2), or
 * undefined when the requirement is not committed yet. Uses
 * `git log -L` on the requirement's line range in HEAD, which follows the
 * range as it moves within the file. Commits that only add or change
 * `drift-ack:` lines in the range do not count. Falls back to the file's
 * last change when `-L` fails.
 */
export async function lastSpecChange(
  git: Git,
  tree: SpecTree,
  requirement: Requirement,
  /** Shares `git show HEAD:<file>` between requirements of the same file. */
  headFiles: Map<string, Promise<Result<string, GitError>>> = new Map(),
): Promise<Result<SpecChange | undefined, GitError>> {
  const file = relativeTo(tree.root, requirement.location.file);
  let pending = headFiles.get(file);
  if (!pending) {
    pending = git.run(["show", `HEAD:./${file}`], { cwd: tree.root });
    headFiles.set(file, pending);
  }
  const head = await pending;
  if (!head.ok) return ok(undefined);

  const { requirements } = parseRequirements(head.value, {
    file,
    feature: requirement.feature,
    prefix: tree.config.ids.requirement,
  });
  const committed = requirements.find((r) => r.id === requirement.id);
  if (!committed) return ok(undefined);

  const { startLine, endLine } = committed.location;
  const log = await git.run(
    ["log", `--format=${recordSeparator}%H%x1f%aI%x1f%s`, "-L", `${startLine},${endLine}:${file}`],
    { cwd: tree.root },
  );
  if (!log.ok) return fallback(git, tree.root, file);

  for (const record of log.value.split(recordSeparator)) {
    if (record.trim() === "") continue;
    const [header = "", ...patch] = record.split("\n");
    const [hash = "", date = "", subject = ""] = header.split("\x1f");
    if (onlyAckLines(patch)) continue;
    return ok({ hash, date: normalizeDate(date), subject });
  }
  return ok(undefined);
}

// True when every added or removed line of the patch is a drift-ack line.
// A creation (`--- /dev/null`) always counts as a change.
function onlyAckLines(patch: string[]): boolean {
  if (patch.some((line) => line === "--- /dev/null")) return false;
  const changed = patch.filter((line) => /^[-+]/.test(line) && !/^(---|\+\+\+) /.test(line));
  return changed.length > 0 && changed.every((line) => /^[-+]\s*drift-ack:/.test(line));
}

async function fallback(git: Git, root: string, file: string): Promise<Result<SpecChange | undefined, GitError>> {
  const log = await git.run(["log", "-1", "--format=%H%x1f%aI%x1f%s", "--", file], { cwd: root });
  if (!log.ok) return err(log.error);
  const [hash = "", date = "", subject = ""] = log.value.trim().split("\x1f");
  return ok(hash ? { hash, date: normalizeDate(date), subject } : undefined);
}

function relativeTo(root: string, path: string): string {
  const file = toPosixPath(path);
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
}
