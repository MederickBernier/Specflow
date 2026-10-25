import { checkDrift, type Finding, type Git, readTraceCommits, type TraceCommit } from "@specflow/core";
import * as vscode from "vscode";
import type { SpecService } from "./spec-service.js";

/** History-derived data for one root: trace commits and drift findings. */
export type RootInsights = { commits: TraceCommit[]; drift?: Finding[]; error?: string };

/**
 * Trace and drift data per spec root, recomputed when asked (spec changes,
 * accept, discard, refresh) and never during a CodeLens request.
 */
export class Insights implements vscode.Disposable {
  readonly #git: Git;
  readonly #byRoot = new Map<string, RootInsights>();
  readonly #changed = new vscode.EventEmitter<string>();
  readonly onDidChange = this.#changed.event;

  constructor(git: Git) {
    this.#git = git;
  }

  get(root: string): RootInsights | undefined {
    return this.#byRoot.get(root);
  }

  /** Recomputes a root's commits and rule-based drift. */
  async refresh(service: SpecService): Promise<void> {
    const tree = service.tree;
    if (!tree) return;
    const commits = await readTraceCommits(this.#git, tree.root);
    const drift = await checkDrift(this.#git, tree);
    this.#byRoot.set(service.root, {
      commits: commits.ok ? commits.value : [],
      ...(drift.ok && { drift: drift.value }),
      ...(!commits.ok && { error: commits.error.message }),
      ...(commits.ok && !drift.ok && { error: drift.error.message }),
    });
    this.#changed.fire(service.root);
  }

  forget(root: string): void {
    this.#byRoot.delete(root);
  }

  dispose(): void {
    this.#changed.dispose();
  }
}
