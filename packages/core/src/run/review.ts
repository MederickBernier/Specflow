import type { FileSystem } from "../fs.js";
import type { Git } from "../git.js";
import type { SpecTree } from "../model.js";
import { err, ok, type Result } from "../result.js";
import type { Recording } from "./recorder.js";
import { restoreTaskStatus, type StatusSnapshot, tasksFile } from "./status.js";

/** A staged recording, as `recordRun` returns it in `staged` mode. */
export type StagedRecording = Extract<Recording, { mode: "staged" }>;

/** A review action that did not complete. */
export type ReviewError = { kind: "git-failed" | "status-failed"; message: string };

const literal = (files: readonly string[]) => files.map((file) => `:(literal)${file}`);

/**
 * Accepts a staged run (vscode-extension/R5): commits exactly its files with
 * the prepared message and trailers, including edits made while reviewing,
 * then removes the message file. Returns the new commit hash.
 */
export async function acceptRecording(
  deps: { git: Git; fs: FileSystem },
  tree: SpecTree,
  recording: StagedRecording,
): Promise<Result<string, ReviewError>> {
  const git = (args: string[], stdin?: string) => deps.git.run(args, { cwd: tree.root, ...(stdin !== undefined && { stdin }) });
  const message = (await deps.fs.exists(recording.messageFile)) ? await deps.fs.readFile(recording.messageFile) : recording.message;
  // Add first, so files created while reviewing and deletions are part of the commit.
  const added = await git(["add", "-A", "--", ...literal(recording.files)]);
  if (!added.ok) return err({ kind: "git-failed", message: added.error.message });
  const committed = await git(["commit", "--quiet", "-F", "-", "--", ...literal(recording.files)], message);
  if (!committed.ok) return err({ kind: "git-failed", message: committed.error.message });
  const head = await git(["rev-parse", "HEAD"]);
  if (!head.ok) return err({ kind: "git-failed", message: head.error.message });
  await deps.fs.writeFile(recording.messageFile, "");
  return ok(head.value.trim());
}

/**
 * Discards a staged run (vscode-extension/R5, task-run/R7): files that exist
 * in HEAD go back to it in the index and working tree, files the run added
 * are removed, and the task's status line is restored from `snapshot`.
 * Changes outside the recording are left alone.
 */
export async function discardRecording(
  deps: { git: Git; fs: FileSystem },
  tree: SpecTree,
  recording: StagedRecording,
  snapshot: StatusSnapshot,
): Promise<Result<void, ReviewError>> {
  const git = (args: string[]) => deps.git.run(args, { cwd: tree.root });
  const statusFile = tasksFile(tree, snapshot.feature);
  const code = recording.files.filter((file) => file !== statusFile);

  const tracked: string[] = [];
  const added: string[] = [];
  for (const file of code) {
    const inHead = await git(["cat-file", "-e", `HEAD:./${file}`]);
    (inHead.ok ? tracked : added).push(file);
  }

  if (tracked.length > 0) {
    const restored = await git(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...literal(tracked)]);
    if (!restored.ok) return err({ kind: "git-failed", message: restored.error.message });
  }
  if (added.length > 0) {
    const removed = await git(["rm", "--quiet", "--force", "--ignore-unmatch", "--", ...literal(added)]);
    if (!removed.ok) return err({ kind: "git-failed", message: removed.error.message });
  }
  // The status line goes back to its snapshot; the rest of tasks.md is left as it is.
  const unstaged = await git(["restore", "--staged", "--", ...literal([statusFile])]);
  if (!unstaged.ok) return err({ kind: "git-failed", message: unstaged.error.message });
  const status = await restoreTaskStatus(deps.fs, tree, snapshot);
  if (!status.ok) return err({ kind: "status-failed", message: status.error.message });
  return ok(undefined);
}
