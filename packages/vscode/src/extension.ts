import { ClaudeCodeAdapter } from "@specflow/adapter-claude-code";
import { AdapterRegistry, findRoot, type InitError, type InitResult, initSpecs, type Result } from "@specflow/core";
import { NodeGit, NodeSpawner, SystemClock } from "@specflow/core/node";
import * as vscode from "vscode";
import { basename } from "node:path";
import { Diagnostics } from "./diagnostics.js";
import { SpecExplorer } from "./explorer.js";
import type { ExplorerNode } from "./explorer-nodes.js";
import { headScheme, ReviewController } from "./run/review.js";
import { RunController } from "./run/run-controller.js";
import { checkHarness } from "./harness-health.js";
import type { ExplorerSource } from "./explorer-nodes.js";
import { SpecService } from "./spec-service.js";
import { corePath, VsCodeFileSystem } from "./vscode-fs.js";

/** Context key: true when a workspace folder has specs. Commands other than init are only shown then. */
export const hasSpecsKey = "specflow.hasSpecs";

const fs = new VsCodeFileSystem();

/** One service per spec root, created as roots appear. */
const services = new Map<string, SpecService>();

const diagnostics = new Diagnostics();

const git = new NodeGit();
const clock = new SystemClock();
const registry = new AdapterRegistry([new ClaudeCodeAdapter({ spawner: new NodeSpawner(), git, clock })]);

const runs = new RunController({ fs, git, registry, clock });
const review = new ReviewController({ git, fs });

/** The config of the first spec root, for harness selection. */
const firstConfig = () => [...services.values()].find((s) => s.tree)?.tree?.config;

const explorer = new SpecExplorer(() =>
  [...services.values()].map((s): ExplorerSource => ({
    root: s.root,
    name: basename(s.root),
    ...(s.tree && { tree: s.tree }),
    ...(s.error && !s.tree && { error: s.error.message }),
  })),
);

/** What `activate` returns; also used by the smoke tests. */
export type SpecflowApi = {
  services: () => SpecService[];
  explorer: SpecExplorer;
  registry: AdapterRegistry;
  runs: RunController;
  review: ReviewController;
};

/** Runs when a workspace contains `.specs/`, or when `Initialize specs` is invoked. */
export async function activate(context: vscode.ExtensionContext): Promise<SpecflowApi> {
  context.subscriptions.push(
    vscode.commands.registerCommand("specflow.init", () => initialize()),
    vscode.commands.registerCommand("specflow.checkHarness", () => checkHarness(registry, firstConfig(), { quiet: false })),
    vscode.commands.registerCommand("specflow.runTask", (node?: ExplorerNode | string, task?: string) => runTaskCommand(node, task)),
    vscode.commands.registerCommand("specflow.cancelRun", () => runs.cancel()),
    vscode.commands.registerCommand("specflow.openDiff", (file: string) => review.openDiff(file)),
    vscode.commands.registerCommand("specflow.acceptRun", () => review.accept()),
    vscode.commands.registerCommand("specflow.discardRun", (options?: { confirm?: boolean }) => review.discard(options)),
    vscode.window.registerTreeDataProvider("specflow.review", review),
    vscode.workspace.registerTextDocumentContentProvider(headScheme, review),
    runs,
    review,
    vscode.commands.registerCommand("specflow.refresh", async () => {
      await Promise.all([...services.values()].map((s) => s.load()));
      explorer.refresh();
      for (const service of services.values()) diagnostics.updateLint(service);
    }),
    vscode.window.registerTreeDataProvider("specflow.specs", explorer),
    explorer,
    diagnostics,
    vscode.workspace.onDidChangeWorkspaceFolders(() => refreshContext()),
    { dispose: () => [...services.values()].forEach((s) => s.dispose()) },
  );
  await refreshContext();
  // vscode-extension/R8: tell the user early if runs cannot work. Not awaited, so activation stays fast.
  if (services.size > 0) void checkHarness(registry, firstConfig(), { quiet: true });
  return { services: () => [...services.values()], explorer, registry, runs, review };
}

export function deactivate(): void {}

/** Workspace folders that contain a spec root, as core paths. */
export async function specRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== "file") continue;
    const root = await findRoot(fs, corePath(folder.uri));
    if (root !== undefined && !roots.includes(root)) roots.push(root);
  }
  return roots;
}

// Keeps one SpecService per spec root and the context key in sync with the workspace.
async function refreshContext(): Promise<void> {
  const roots = await specRoots();
  for (const [root, service] of services) {
    if (!roots.includes(root)) {
      service.dispose();
      services.delete(root);
      diagnostics.clear(root);
    }
  }
  for (const root of roots) {
    if (services.has(root)) continue;
    const service = new SpecService(root, fs);
    services.set(root, service);
    service.onDidChange(() => {
      explorer.refresh();
      diagnostics.updateLint(service);
    });
    await service.start();
    diagnostics.updateLint(service);
  }
  explorer.refresh();
  await vscode.commands.executeCommand("setContext", hasSpecsKey, roots.length > 0);
}

/** The `specflow.init` command. Returns what happened, for tests; undefined when cancelled. */
async function initialize(): Promise<Result<InitResult, InitError | { kind: "no-folder"; message: string }> | undefined> {
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file");
  if (folders.length === 0) {
    const message = "Open a folder first, then initialize specs in it.";
    void vscode.window.showErrorMessage(`Specflow: ${message}`);
    return { ok: false, error: { kind: "no-folder", message } };
  }
  const folder =
    folders.length === 1
      ? folders[0]
      : await vscode.window.showWorkspaceFolderPick({ placeHolder: "Folder to initialize specs in" });
  if (!folder) return undefined;

  const result = await initSpecs(fs, corePath(folder.uri));
  if (!result.ok) {
    void vscode.window.showWarningMessage(`Specflow: ${result.error.message}`);
    return result;
  }
  await refreshContext();
  const product = vscode.Uri.file(`${result.value.root}/.specs/product.md`);
  await vscode.window.showTextDocument(product);
  void vscode.window.showInformationMessage(
    `Specflow: created ${result.value.created.length} files in .specs/. Edit product.md and tech.md, then run Specflow: Lint.`,
  );
  return result;
}

/**
 * `specflow.runTask`: from a task node in the explorer, with (feature, task)
 * arguments, or from the palette with a pick of the open tasks.
 */
async function runTaskCommand(node?: ExplorerNode | string, taskId?: string) {
  let target: { root?: string; feature: string; id: string } | undefined;
  if (typeof node === "object" && node.ref) target = node.ref;
  else if (typeof node === "string" && taskId) target = { feature: node, id: taskId };
  else {
    const picks = [...services.values()].flatMap((s) =>
      (s.tree?.features ?? []).flatMap((f) =>
        f.tasks
          .filter((t) => t.status !== "done")
          .map((t) => ({ label: `${f.name}/${t.id}`, description: t.title, detail: t.status, ref: { root: s.root, feature: f.name, id: t.id } })),
      ),
    );
    if (picks.length === 0) {
      void vscode.window.showInformationMessage("Specflow: every task is done.");
      return undefined;
    }
    target = (await vscode.window.showQuickPick(picks, { placeHolder: "Task to run" }))?.ref;
  }
  if (!target) return undefined;

  const service =
    (target.root && services.get(target.root)) ||
    [...services.values()].find((s) => s.tree?.features.some((f) => f.name === target.feature && f.tasks.some((t) => t.id === target.id)));
  if (!service?.tree) {
    void vscode.window.showErrorMessage(`Specflow: no task ${target.feature}/${target.id}`);
    return undefined;
  }
  if (review.pending) {
    void vscode.window.showWarningMessage("Specflow: accept or discard the run under review first.");
    return undefined;
  }
  const result = await runs.run(service.tree, target.feature, target.id);
  if (result?.recording?.mode === "staged") await review.start(service.tree, result);
  return result;
}
