import { ClaudeCodeAdapter } from "@specflow/adapter-claude-code";
import { AdapterRegistry, findRoot, type InitError, type InitResult, initSpecs, type Result, trace } from "@specflow/core";
import { NodeGit, NodeSpawner, SystemClock } from "@specflow/core/node";
import * as vscode from "vscode";
import { basename } from "node:path";
import { CommitDocuments, commitScheme, SpecCodeLens } from "./codelens.js";
import { lintCommand, showCommand } from "./commands.js";
import { Diagnostics } from "./diagnostics.js";
import { SpecExplorer } from "./explorer.js";
import type { ExplorerNode } from "./explorer-nodes.js";
import { headScheme, ReviewController } from "./run/review.js";
import { RunController } from "./run/run-controller.js";
import { findingsByFile } from "./diagnostics-data.js";
import { checkHarness } from "./harness-health.js";
import { Insights } from "./insights.js";
import type { ExplorerSource } from "./explorer-nodes.js";
import { SpecService } from "./spec-service.js";
import { corePath, VsCodeFileSystem } from "./vscode-fs.js";
import { type OpenWorkbenchOptions, WorkbenchPanel, workbenchViewType } from "./workbench/panel.js";

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
const insights = new Insights(git);
const lenses = new SpecCodeLens(() => [...services.values()], insights);

/** `specflow.driftOnSave`: run the rule-based drift pass whenever a spec file is saved. */
const driftOnSave = () => vscode.workspace.getConfiguration("specflow").get<boolean>("driftOnSave", false);

/** Recomputes trace data for every root, and drift when asked or when driftOnSave is on. */
async function refreshInsights(options: { drift?: boolean } = {}): Promise<void> {
  await Promise.all([...services.values()].map((s) => insights.refresh(s, { drift: options.drift ?? driftOnSave() })));
}

/** Puts a root's drift findings in the Problems panel, or clears them when drift was not checked. */
function showDrift(root: string): void {
  diagnostics.replace(diagnostics.drift, root, findingsByFile(insights.get(root)?.drift ?? []));
}

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
  insights: Insights;
  refreshInsights: (options?: { drift?: boolean }) => Promise<void>;
  workbench: WorkbenchPanel;
};

/** Runs when a workspace contains `.specs/`, or when `Initialize specs` is invoked. */
export async function activate(context: vscode.ExtensionContext): Promise<SpecflowApi> {
  const workbench = new WorkbenchPanel(context.extensionUri);
  context.subscriptions.push(
    workbench,
    vscode.window.registerWebviewPanelSerializer(workbenchViewType, workbench),
    vscode.commands.registerCommand("specflow.openWorkbench", (options?: OpenWorkbenchOptions) => {
      workbench.open(options);
    }),
    vscode.commands.registerCommand("specflow.init", () => initialize()),
    vscode.commands.registerCommand("specflow.lint", () => lintCommand([...services.values()], diagnostics)),
    vscode.commands.registerCommand("specflow.show", (target?: string) => showCommand([...services.values()], target)),
    vscode.commands.registerCommand("specflow.checkHarness", () => checkHarness(registry, firstConfig(), { quiet: false })),
    vscode.commands.registerCommand("specflow.runTask", (node?: ExplorerNode | string, task?: string) => runTaskCommand(node, task)),
    vscode.commands.registerCommand("specflow.cancelRun", () => runs.cancel()),
    vscode.commands.registerCommand("specflow.openDiff", (file: string) => review.openDiff(file)),
    vscode.commands.registerCommand("specflow.acceptRun", async () => {
      const commit = await review.accept();
      await refreshInsights();
      return commit;
    }),
    vscode.commands.registerCommand("specflow.discardRun", async (options?: { confirm?: boolean }) => {
      const discarded = await review.discard(options);
      await refreshInsights();
      return discarded;
    }),
    vscode.window.registerTreeDataProvider("specflow.review", review),
    vscode.languages.registerCodeLensProvider({ scheme: "file", pattern: "**/*.md" }, lenses),
    vscode.workspace.registerTextDocumentContentProvider(commitScheme, new CommitDocuments(git)),
    vscode.commands.registerCommand("specflow.showTrace", (target?: string | ExplorerNode, options?: { show?: boolean }) => showTrace(target, options)),
    insights.onDidChange((root) => {
      lenses.refresh();
      showDrift(root);
    }),
    vscode.commands.registerCommand("specflow.checkDrift", async () => {
      await refreshInsights({ drift: true });
      const findings = [...services.values()].flatMap((s) => insights.get(s.root)?.drift ?? []);
      void vscode.window.showInformationMessage(
        findings.length === 0 ? "Specflow: no drift found." : `Specflow: ${findings.length} drift finding${findings.length === 1 ? "" : "s"}, shown in Problems.`,
      );
      return findings;
    }),
    insights,
    lenses,
    vscode.workspace.registerTextDocumentContentProvider(headScheme, review),
    runs,
    review,
    vscode.commands.registerCommand("specflow.refresh", async () => {
      await Promise.all([...services.values()].map((s) => s.load()));
      explorer.refresh();
      for (const service of services.values()) diagnostics.updateLint(service);
      lenses.refresh();
      await refreshInsights();
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
  return { services: () => [...services.values()], explorer, registry, runs, review, insights, refreshInsights, workbench };
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
      insights.forget(root);
    }
  }
  for (const root of roots) {
    if (services.has(root)) continue;
    const service = new SpecService(root, fs);
    services.set(root, service);
    service.onDidChange(() => {
      explorer.refresh();
      lenses.refresh();
      diagnostics.updateLint(service);
      void insights.refresh(service, { drift: driftOnSave() });
    });
    await service.start();
    diagnostics.updateLint(service);
    void insights.refresh(service, { drift: driftOnSave() });
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

/**
 * `specflow.showTrace`: the tasks and commits behind a requirement or task
 * (vscode-extension/R7), in a quick pick; picking a commit opens it. With
 * `{ show: false }` it only returns the items, for tests.
 */
async function showTrace(target?: string | ExplorerNode, options: { show?: boolean } = {}) {
  let ref = typeof target === "string" ? target : target?.ref ? `${target.ref.feature}/${target.ref.id}` : undefined;
  ref ??= await vscode.window.showInputBox({ prompt: "Feature, or feature/ID such as auth/R3" });
  if (!ref) return undefined;
  const feature = ref.split("/")[0];
  const service = [...services.values()].find((s) => s.tree?.features.some((f) => f.name === feature));
  if (!service?.tree) {
    void vscode.window.showErrorMessage(`Specflow: no feature ${feature}`);
    return undefined;
  }
  if (!insights.get(service.root)) await insights.refresh(service, { drift: driftOnSave() });
  const result = trace(service.tree, insights.get(service.root)?.commits ?? [], ref);
  if (!result.ok) {
    void vscode.window.showErrorMessage(`Specflow: ${result.error.message}`);
    return undefined;
  }

  type Item = vscode.QuickPickItem & { hash?: string };
  const items: Item[] = [];
  const traced = result.value;
  const tasks = traced.kind === "requirement" ? traced.trace.tasks : traced.kind === "task" ? [traced.trace] : traced.trace.tasks;
  const commits = traced.kind === "feature" ? traced.trace.tasks.flatMap((t) => t.commits) : traced.trace.commits;
  items.push({ label: "Tasks", kind: vscode.QuickPickItemKind.Separator });
  for (const t of tasks) items.push({ label: `${t.feature}/${t.id}`, description: t.title, detail: t.status });
  items.push({ label: "Commits", kind: vscode.QuickPickItemKind.Separator });
  for (const c of commits) {
    items.push({ label: c.subject, description: `${c.hash.slice(0, 7)} · ${c.date.slice(0, 10)}`, detail: c.files.map((f) => f.path).join(", "), hash: c.hash });
  }
  if (commits.length === 0) items.push({ label: "No commits reference it yet" });
  if (options.show === false) return items;

  const picked = await vscode.window.showQuickPick(items, { placeHolder: `Trace of ${ref}` });
  if (picked?.hash) {
    await vscode.window.showTextDocument(vscode.Uri.from({ scheme: commitScheme, path: service.root, query: picked.hash }));
  }
  return items;
}
