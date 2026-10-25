import { fullRef, type Git, joinPath, toPosixPath } from "@specflow/core";
import * as vscode from "vscode";
import type { Insights } from "./insights.js";
import { requirementLensTitle, taskLensTitle } from "./lens-titles.js";
import type { SpecService } from "./spec-service.js";

/** URI scheme showing `git show` of a commit from a trace. */
export const commitScheme = "specflow-commit";

/** Run lenses on task headings and summary lenses on requirement headings (vscode-extension/R4, R7). */
export class SpecCodeLens implements vscode.CodeLensProvider, vscode.Disposable {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.#changed.event;
  readonly #services: () => SpecService[];
  readonly #insights: Insights;

  constructor(services: () => SpecService[], insights: Insights) {
    this.#services = services;
    this.#insights = insights;
  }

  refresh(): void {
    this.#changed.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const file = toPosixPath(document.uri.fsPath);
    const lenses: vscode.CodeLens[] = [];
    for (const service of this.#services()) {
      const tree = service.tree;
      if (!tree) continue;
      const insights = this.#insights.get(service.root);
      for (const feature of tree.features) {
        if (joinPath(feature.dir, "tasks.md") === file) {
          for (const task of feature.tasks) {
            lenses.push(
              new vscode.CodeLens(line(task.location.startLine), {
                title: taskLensTitle(task),
                command: "specflow.runTask",
                arguments: [feature.name, task.id],
              }),
            );
          }
        }
        if (joinPath(feature.dir, "requirements.md") === file) {
          for (const requirement of feature.requirements) {
            lenses.push(
              new vscode.CodeLens(line(requirement.location.startLine), {
                title: requirementLensTitle(tree, requirement, insights?.commits ?? [], insights?.drift),
                command: "specflow.showTrace",
                arguments: [fullRef(feature.name, requirement.id)],
              }),
            );
          }
        }
      }
    }
    return lenses;
  }

  dispose(): void {
    this.#changed.dispose();
  }
}

/** Serves `specflow-commit:/<root>?<hash>` as `git show --stat` of that commit. */
export class CommitDocuments implements vscode.TextDocumentContentProvider {
  readonly #git: Git;

  constructor(git: Git) {
    this.#git = git;
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const shown = await this.#git.run(["show", "--stat", "--format=fuller", uri.query], { cwd: uri.path });
    return shown.ok ? shown.value : shown.error.message;
  }
}

function line(startLine: number): vscode.Range {
  const at = Math.max(0, startLine - 1);
  return new vscode.Range(at, 0, at, 0);
}
