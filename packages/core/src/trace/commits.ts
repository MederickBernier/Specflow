import type { Git, GitError } from "../git.js";
import { fullRef, resolveRef } from "../lint/refs.js";
import { err, ok, type Result } from "../result.js";

/** One file a commit touched, from `git log --name-status`. `from` is the old path of a rename or copy. */
export type CommitFile = { status: string; path: string; from?: string };

/** A commit carrying spec trailers. References are full (`feature/R3`). */
export type TraceCommit = {
  hash: string;
  /** Author date, ISO 8601. Rebases keep it. */
  date: string;
  subject: string;
  files: CommitFile[];
  features: string[];
  tasks: string[];
  reqs: string[];
};

const fieldSeparator = "\x1f";
const trailerSeparator = "\x1d";
const recordSeparator = "\x1e";

/** Arguments for one `git log` call over every commit, newest first, with files and spec trailers. */
export const historyLogArgs = [
  "log",
  "-z",
  "--name-status",
  "-M",
  `--format=${recordSeparator}%H${fieldSeparator}%aI${fieldSeparator}%s${fieldSeparator}%(trailers:key=Spec-Feature,key=Spec-Task,key=Spec-Req,unfold,separator=%x1d)`,
];

/** {@link historyLogArgs} restricted to commits that mention a spec trailer key. */
export const traceLogArgs = [...historyLogArgs, "-E", "--grep=^Spec-(Feature|Task|Req):"];

/**
 * Reads every commit on the current branch whose trailers reference the spec,
 * newest first (task-run/R8). Reads trailers, not stored hashes, so it
 * survives rebases.
 */
export async function readTraceCommits(git: Git, cwd: string): Promise<Result<TraceCommit[], GitError>> {
  const log = await readLog(git, cwd, traceLogArgs);
  return log.ok ? ok(parseTraceLog(log.value)) : log;
}

/**
 * Reads every commit on the current branch, newest first, in one `git log`
 * call. Commits without trailers have empty `tasks` and `reqs`.
 */
export async function readHistory(git: Git, cwd: string): Promise<Result<TraceCommit[], GitError>> {
  const log = await readLog(git, cwd, historyLogArgs);
  return log.ok ? ok(parseHistory(log.value)) : log;
}

async function readLog(git: Git, cwd: string, args: string[]): Promise<Result<string, GitError>> {
  const log = await git.run(args, { cwd });
  // A repository without commits has no history.
  if (!log.ok && /does not have any commits/.test(log.error.stderr)) return ok("");
  return log;
}

/** Parses the output of {@link traceLogArgs}. Commits whose trailers name no task or requirement are left out. */
export function parseTraceLog(output: string): TraceCommit[] {
  return parseHistory(output).filter((commit) => commit.tasks.length > 0 || commit.reqs.length > 0);
}

/** Parses the output of {@link historyLogArgs}, keeping every commit. */
export function parseHistory(output: string): TraceCommit[] {
  const commits: TraceCommit[] = [];
  for (const record of output.split(recordSeparator)) {
    if (record.trim() === "") continue;
    const [header = "", ...rest] = record.split("\0");
    const [hash = "", date = "", subject = "", trailerText = ""] = header.split(fieldSeparator);

    const trailers: Record<string, string[]> = {};
    for (const trailer of trailerText.split(trailerSeparator)) {
      const match = /^(Spec-Feature|Spec-Task|Spec-Req):\s*(.*)$/.exec(trailer.trim());
      if (match) (trailers[match[1]!] ??= []).push(...splitValues(match[2]!));
    }
    const features = trailers["Spec-Feature"] ?? [];
    const resolve = (refs: string[]) =>
      refs.flatMap((ref) => {
        if (ref.includes("/")) {
          const target = resolveRef(ref, "");
          return [fullRef(target.feature, target.id)];
        }
        // A bare ID only resolves when the commit names exactly one feature.
        return features.length === 1 ? [fullRef(features[0]!, ref)] : [];
      });
    const tasks = resolve(trailers["Spec-Task"] ?? []);
    const reqs = resolve(trailers["Spec-Req"] ?? []);
    commits.push({ hash, date: normalizeDate(date), subject, files: parseNameStatus(rest), features, tasks, reqs });
  }
  return commits;
}

/**
 * Git versions print a UTC `%aI` as `...Z` or `...+00:00`; this returns the
 * `+00:00` form so output is the same on every platform.
 */
export function normalizeDate(date: string): string {
  return date.replace(/Z$/, "+00:00");
}

function parseNameStatus(tokens: string[]): CommitFile[] {
  const files: CommitFile[] = [];
  const list = tokens.map((t) => t.replace(/^\n/, ""));
  for (let i = 0; i < list.length; i++) {
    const status = list[i]!;
    if (status === "") continue;
    if (status[0] === "R" || status[0] === "C") {
      files.push({ status, from: list[i + 1]!, path: list[i + 2]! });
      i += 2;
    } else {
      files.push({ status, path: list[i + 1]! });
      i += 1;
    }
  }
  return files;
}

// Trailer values are comma separated; `none` means no reference.
function splitValues(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "" && v.toLowerCase() !== "none");
}
