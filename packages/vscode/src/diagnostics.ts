import { joinPath, lint } from "@specflow/core";
import * as vscode from "vscode";
import { type DiagnosticData, findingsByFile } from "./diagnostics-data.js";
import type { SpecService } from "./spec-service.js";

const severities = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
} as const;

/**
 * Spec findings in the Problems panel. Lint and drift use separate
 * collections so each can be cleared on its own (vscode-extension/R3, R6).
 */
export class Diagnostics implements vscode.Disposable {
  readonly lint = vscode.languages.createDiagnosticCollection("specflow-lint");
  readonly drift = vscode.languages.createDiagnosticCollection("specflow-drift");
  // Files each root last reported in each collection, so fixed problems disappear.
  readonly #reported = new Map<vscode.DiagnosticCollection, Map<string, vscode.Uri[]>>();

  /** Replaces a root's lint diagnostics with the findings of its current tree, or its load error. */
  updateLint(service: SpecService): void {
    if (service.tree) {
      this.#replace(this.lint, service.root, findingsByFile(lint(service.tree)));
    } else if (service.error) {
      const config = joinPath(service.root, ".specs/config.yml");
      this.#replace(this.lint, service.root, new Map([[config, [{ startLine: 1, endLine: 1, message: service.error.message, severity: "error", code: service.error.kind }]]]));
    }
  }

  /** Replaces a root's entries in `collection`. */
  replace(collection: vscode.DiagnosticCollection, root: string, byFile: Map<string, DiagnosticData[]>): void {
    this.#replace(collection, root, byFile);
  }

  /** Removes everything a root reported, for example when it goes away. */
  clear(root: string): void {
    for (const collection of [this.lint, this.drift]) this.#replace(collection, root, new Map());
  }

  dispose(): void {
    this.lint.dispose();
    this.drift.dispose();
  }

  #replace(collection: vscode.DiagnosticCollection, root: string, byFile: Map<string, DiagnosticData[]>): void {
    const perRoot = this.#reported.get(collection) ?? new Map<string, vscode.Uri[]>();
    this.#reported.set(collection, perRoot);
    for (const uri of perRoot.get(root) ?? []) collection.delete(uri);
    const uris: vscode.Uri[] = [];
    for (const [file, items] of byFile) {
      const uri = vscode.Uri.file(file);
      uris.push(uri);
      collection.set(uri, items.map(toDiagnostic));
    }
    perRoot.set(root, uris);
  }
}

function toDiagnostic(item: DiagnosticData): vscode.Diagnostic {
  const range = new vscode.Range(item.startLine - 1, 0, item.endLine - 1, Number.MAX_SAFE_INTEGER);
  const diagnostic = new vscode.Diagnostic(range, item.message, severities[item.severity]);
  diagnostic.code = item.code;
  diagnostic.source = "specflow";
  return diagnostic;
}
