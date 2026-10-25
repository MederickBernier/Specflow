import { acceptRecording, discardRecording, type Git, type RunTaskResult, type SpecTree, type StagedRecording } from "@specflow/core";
import * as vscode from "vscode";
import type { VsCodeFileSystem } from "../vscode-fs.js";

/** Context key: true while a staged run waits for accept or discard. */
export const reviewingKey = "specflow.reviewing";

/** URI scheme serving `git show HEAD:<file>`, the left side of review diffs. */
export const headScheme = "specflow-head";

type Pending = { tree: SpecTree; result: RunTaskResult; recording: StagedRecording };
type ReviewFile = { path: string; change: "added" | "modified" | "deleted" };

/**
 * Review of a staged run (vscode-extension/R5): the changed files, each
 * opening VS Code's diff editor against HEAD, then accept (commit with the
 * prepared trailers) or discard (restore the files and the task status).
 */
export class ReviewController implements vscode.TreeDataProvider<ReviewFile>, vscode.TextDocumentContentProvider, vscode.Disposable {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#changed.event;
  readonly #deps: { git: Git; fs: VsCodeFileSystem };
  #pending: Pending | undefined;

  constructor(deps: { git: Git; fs: VsCodeFileSystem }) {
    this.#deps = deps;
  }

  /** The run under review, if any. */
  get pending(): Pending | undefined {
    return this.#pending;
  }

  /** Files of the run under review, with how each changed. */
  files(): ReviewFile[] {
    if (!this.#pending) return [];
    const changes = new Map<string, ReviewFile["change"]>();
    for (const event of this.#pending.result.events) {
      if (event.kind === "file-changed") changes.set(event.path, event.change);
    }
    return this.#pending.recording.files.map((path) => ({ path, change: changes.get(path) ?? "modified" }));
  }

  async start(tree: SpecTree, result: RunTaskResult): Promise<void> {
    if (result.recording?.mode !== "staged") return;
    this.#pending = { tree, result, recording: result.recording };
    await this.#refresh();
  }

  /** Opens the built-in diff editor: HEAD on the left, the working file on the right. */
  async openDiff(file: string): Promise<void> {
    const pending = this.#pending;
    if (!pending) return;
    const change = this.files().find((f) => f.path === file)?.change ?? "modified";
    const working = vscode.Uri.file(`${pending.tree.root}/${file}`);
    const head = vscode.Uri.from({ scheme: headScheme, path: `/${file}`, query: change === "added" ? "empty" : "" });
    const right = change === "deleted" ? vscode.Uri.from({ scheme: headScheme, path: `/${file}`, query: "empty" }) : working;
    await vscode.commands.executeCommand("vscode.diff", head, right, `${file} (HEAD ↔ run)`);
  }

  /** Commits the run's files with the prepared message. Returns the commit hash. */
  async accept(): Promise<string | undefined> {
    const pending = this.#pending;
    if (!pending) return undefined;
    const result = await acceptRecording(this.#deps, pending.tree, pending.recording);
    if (!result.ok) {
      void vscode.window.showErrorMessage(`Specflow: could not commit: ${result.error.message}`);
      return undefined;
    }
    this.#pending = undefined;
    await this.#refresh();
    void vscode.window.showInformationMessage(`Specflow: committed ${result.value.slice(0, 7)}.`);
    return result.value;
  }

  /** Restores the run's files and the task status, after confirming unless `confirm` is false. */
  async discard(options: { confirm?: boolean } = {}): Promise<boolean> {
    const pending = this.#pending;
    if (!pending) return false;
    if (options.confirm !== false) {
      const { feature, task } = pending.result.snapshot;
      const choice = await vscode.window.showWarningMessage(
        `Discard the changes of ${feature}/${task} to ${pending.recording.files.length} files and restore its status?`,
        { modal: true, detail: "Files go back to HEAD and files the run added are deleted. Other changes are kept." },
        "Discard",
      );
      if (choice !== "Discard") return false;
    }
    const result = await discardRecording(this.#deps, pending.tree, pending.recording, pending.result.snapshot);
    if (!result.ok) {
      void vscode.window.showErrorMessage(`Specflow: could not discard: ${result.error.message}`);
      return false;
    }
    this.#pending = undefined;
    await this.#refresh();
    return true;
  }

  getChildren(): ReviewFile[] {
    return this.files();
  }

  getTreeItem(file: ReviewFile): vscode.TreeItem {
    const item = new vscode.TreeItem(file.path);
    item.description = file.change;
    item.iconPath = new vscode.ThemeIcon({ added: "diff-added", modified: "diff-modified", deleted: "diff-removed" }[file.change]);
    item.command = { command: "specflow.openDiff", title: "Open diff", arguments: [file.path] };
    return item;
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    if (uri.query === "empty" || !this.#pending) return "";
    const shown = await this.#deps.git.run(["show", `HEAD:.${uri.path}`], { cwd: this.#pending.tree.root });
    return shown.ok ? shown.value : "";
  }

  dispose(): void {
    this.#changed.dispose();
  }

  async #refresh(): Promise<void> {
    this.#changed.fire();
    await vscode.commands.executeCommand("setContext", reviewingKey, this.#pending !== undefined);
  }
}
