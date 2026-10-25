import { type Finding, lint, type SpecTree } from "@specflow/core";
import * as vscode from "vscode";
import type { Diagnostics } from "./diagnostics.js";
import type { SpecService } from "./spec-service.js";

/**
 * Every CLI command and its command palette equivalent (vscode-extension/R9).
 * commands.test.ts checks this against the CLI and package.json.
 */
export const cliParity = {
  init: "specflow.init",
  lint: "specflow.lint",
  show: "specflow.show",
  run: "specflow.runTask",
  trace: "specflow.showTrace",
  drift: "specflow.checkDrift",
  "harness check": "specflow.checkHarness",
} as const;

/** `specflow.lint`: refreshes lint diagnostics, opens Problems and returns the findings. */
export async function lintCommand(services: SpecService[], diagnostics: Diagnostics): Promise<Finding[]> {
  await Promise.all(services.map((s) => s.load()));
  const findings: Finding[] = [];
  for (const service of services) {
    diagnostics.updateLint(service);
    if (service.tree) findings.push(...lint(service.tree));
  }
  if (findings.length > 0) await vscode.commands.executeCommand("workbench.actions.view.problems");
  void vscode.window.showInformationMessage(
    findings.length === 0 ? "Specflow: no problems found." : `Specflow: ${findings.length} problem${findings.length === 1 ? "" : "s"}, shown in Problems.`,
  );
  return findings;
}

/** `specflow.show`: opens a feature, requirement or task, picked or given as `feature[/id]`. */
export async function showCommand(services: SpecService[], target?: string): Promise<vscode.Location | undefined> {
  const trees = services.flatMap((s) => (s.tree ? [s.tree] : []));
  const items = trees.flatMap(showItems);
  const picked = target ? items.find((i) => i.label === target) : await vscode.window.showQuickPick(items, { placeHolder: "Feature, requirement or task" });
  if (!picked) {
    if (target) void vscode.window.showErrorMessage(`Specflow: nothing named ${target}`);
    return undefined;
  }
  const line = Math.max(0, picked.line - 1);
  const location = new vscode.Location(vscode.Uri.file(picked.file), new vscode.Position(line, 0));
  await vscode.window.showTextDocument(location.uri, { selection: new vscode.Range(line, 0, line, 0) });
  return location;
}

type ShowItem = vscode.QuickPickItem & { file: string; line: number };

function showItems(tree: SpecTree): ShowItem[] {
  return tree.features.flatMap((feature): ShowItem[] => {
    const first = feature.requirements[0]?.location.file ?? feature.tasks[0]?.location.file;
    return [
      ...(first ? [{ label: feature.name, description: "feature", file: first, line: 1 }] : []),
      ...feature.requirements.map((r) => ({ label: `${feature.name}/${r.id}`, description: r.title, detail: r.status, file: r.location.file, line: r.location.startLine })),
      ...feature.tasks.map((t) => ({ label: `${feature.name}/${t.id}`, description: t.title, detail: t.status, file: t.location.file, line: t.location.startLine })),
    ];
  });
}
