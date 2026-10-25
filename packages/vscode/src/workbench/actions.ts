import { type FileSystem, type Git, readCommitDiff, readWorkingDiff } from "@specflow/core";
import * as vscode from "vscode";
import type { WorkbenchIntent } from "./panel.js";
import { type DiffAnswer, type HostMessage, workbenchCommands } from "./protocol.js";

/** What the actions need: git and files for diffs, the review's files, and a way to answer the page. */
export type ActionDeps = {
  git: Git;
  fs: FileSystem;
  /** Paths of the run under review, relative to its root. */
  reviewFiles: () => string[];
  send: (message: HostMessage) => void;
};

/**
 * Carries out what the workbench page asks for, through the same commands as
 * the palette, so confirmations and refreshes stay in one place.
 */
export async function handleIntent(intent: WorkbenchIntent, deps: ActionDeps): Promise<void> {
  switch (intent.type) {
    case "command":
      await vscode.commands.executeCommand(workbenchCommands[intent.command]);
      break;
    case "run":
      // The same command as the explorer's ▶, with the root, so confirmation and checks match (workbench-ui/R3).
      await vscode.commands.executeCommand("specflow.runTask", { ref: { root: intent.root, feature: intent.feature, id: intent.task } });
      break;
    case "open":
      await vscode.commands.executeCommand("specflow.show", `${intent.feature}/${intent.id}`);
      break;
    case "openDiff":
      await vscode.commands.executeCommand("specflow.openDiff", intent.path);
      break;
    case "diff":
      deps.send({ type: "diff", ...(await answerDiff(intent, deps)) });
      break;
  }
}

/** Reads the diff a page asked for (workbench-ui/R4, R5); validation already checked it names what the state shows. */
export async function answerDiff(request: Extract<WorkbenchIntent, { type: "diff" }>, deps: ActionDeps): Promise<DiffAnswer> {
  const { source, root, revision } = request;
  const echo = { source, root, revision, ...(request.path && { path: request.path }), ...(request.commit && { commit: request.commit }) };
  const result =
    source === "commit"
      ? await readCommitDiff(deps.git, root, request.commit!)
      : await readWorkingDiff(deps.git, deps.fs, root, source === "review" ? { paths: request.path ? [request.path] : deps.reviewFiles() } : {});
  return result.ok ? { ...echo, files: result.value.files, truncated: result.value.truncated } : { ...echo, error: result.error.message };
}
