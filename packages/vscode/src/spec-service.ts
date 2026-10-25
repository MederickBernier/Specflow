import { type LoadError, loadSpecTree, type SpecTree } from "@specflow/core";
import * as vscode from "vscode";
import { Debouncer } from "./debounce.js";
import type { VsCodeFileSystem } from "./vscode-fs.js";

/** How long after the last spec file change the tree is reloaded. */
export const reloadDebounceMs = 300;

/**
 * The spec tree of one root, kept current: watches the specs folder and
 * reloads 300 ms after the last change, then fires `onDidChange` once
 * (vscode-extension/R2).
 */
export class SpecService implements vscode.Disposable {
  readonly root: string;
  /** The last successfully loaded tree. */
  tree: SpecTree | undefined;
  /** Why the last load failed, if it did. */
  error: LoadError | undefined;
  readonly #fs: VsCodeFileSystem;
  readonly #changed = new vscode.EventEmitter<SpecService>();
  readonly #reload = new Debouncer(reloadDebounceMs, () => void this.#reloadAndNotify());
  #watchers: vscode.FileSystemWatcher[] = [];
  readonly onDidChange = this.#changed.event;

  constructor(root: string, fs: VsCodeFileSystem) {
    this.root = root;
    this.#fs = fs;
  }

  /** Loads the tree and starts watching. */
  async start(): Promise<void> {
    await this.load();
    this.#watch();
  }

  /** Loads the tree now, without notifying. */
  async load(): Promise<void> {
    const result = await loadSpecTree(this.#fs, this.root);
    if (result.ok) {
      this.tree = result.value;
      this.error = undefined;
    } else {
      this.error = result.error;
    }
  }

  dispose(): void {
    this.#reload.dispose();
    for (const watcher of this.#watchers) watcher.dispose();
    this.#changed.dispose();
  }

  // Watches .specs/ (where config.yml lives) and the configured specsDir, if different.
  #watch(): void {
    for (const watcher of this.#watchers) watcher.dispose();
    const dirs = new Set([".specs", this.tree?.config.specsDir ?? ".specs"]);
    this.#watchers = [...dirs].map((dir) => {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(this.root), `${dir}/**`));
      const trigger = () => this.#reload.trigger();
      watcher.onDidChange(trigger);
      watcher.onDidCreate(trigger);
      watcher.onDidDelete(trigger);
      return watcher;
    });
  }

  async #reloadAndNotify(): Promise<void> {
    const before = this.tree?.config.specsDir;
    await this.load();
    if (this.tree?.config.specsDir !== before) this.#watch();
    this.#changed.fire(this);
  }
}
