import { findRoot, type InitError, type InitResult, initSpecs, type Result } from "@specflow/core";
import * as vscode from "vscode";
import { SpecService } from "./spec-service.js";
import { corePath, VsCodeFileSystem } from "./vscode-fs.js";

/** Context key: true when a workspace folder has specs. Commands other than init are only shown then. */
export const hasSpecsKey = "specflow.hasSpecs";

const fs = new VsCodeFileSystem();

/** One service per spec root, created as roots appear. */
const services = new Map<string, SpecService>();

/** What `activate` returns; also used by the smoke tests. */
export type SpecflowApi = { services: () => SpecService[] };

/** Runs when a workspace contains `.specs/`, or when `Initialize specs` is invoked. */
export async function activate(context: vscode.ExtensionContext): Promise<SpecflowApi> {
  context.subscriptions.push(
    vscode.commands.registerCommand("specflow.init", () => initialize()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => refreshContext()),
    { dispose: () => [...services.values()].forEach((s) => s.dispose()) },
  );
  await refreshContext();
  return { services: () => [...services.values()] };
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
    }
  }
  for (const root of roots) {
    if (services.has(root)) continue;
    const service = new SpecService(root, fs);
    services.set(root, service);
    await service.start();
  }
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
