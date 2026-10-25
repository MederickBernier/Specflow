import { ackDrift, type AckError, type DriftAck, type FileSystem, type Finding, type Git, lint, type Result, type SpecTree } from "@specflow/core";
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
  "drift ack": "specflow.ackDrift",
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

/**
 * `specflow.ackDrift` (workbench-ui/R7): writes `drift-ack: <commit>` on a
 * requirement, as `specflow drift ack` does. The requirement and commit are
 * asked for when not given; the latest drift commit of that requirement is
 * offered. Asks for confirmation unless `confirm` is false. Returns what was
 * written, or undefined when cancelled or refused.
 */
export async function ackDriftCommand(
  services: SpecService[],
  deps: { fs: FileSystem; git: Git; drift: (root: string) => Finding[] | undefined },
  ref?: string,
  commit?: string,
  options: { confirm?: boolean } = {},
): Promise<Result<DriftAck, AckError> | undefined> {
  if (!ref) {
    const picks = services.flatMap((s) =>
      (s.tree?.features ?? []).flatMap((f) => f.requirements.map((r) => ({ label: `${f.name}/${r.id}`, description: r.title }))),
    );
    ref = (await vscode.window.showQuickPick(picks, { placeHolder: "Requirement whose drift to acknowledge" }))?.label;
    if (!ref) return undefined;
  }
  const feature = ref.slice(0, ref.lastIndexOf("/"));
  const service = services.find((s) => s.tree?.features.some((f) => f.name === feature));
  if (!service?.tree) {
    void vscode.window.showErrorMessage(`Specflow: no requirement ${ref}`);
    return undefined;
  }
  if (!commit) {
    const id = ref.slice(ref.lastIndexOf("/") + 1);
    const latest = deps.drift(service.root)?.find((f) => f.feature === feature && f.id === id && f.evidence?.commit)?.evidence?.commit;
    commit = await vscode.window.showInputBox({ prompt: `Acknowledge drift on ${ref} up to this commit`, value: latest ?? "HEAD" });
    if (!commit) return undefined;
  }
  if (options.confirm !== false) {
    const choice = await vscode.window.showWarningMessage(
      `Acknowledge drift on ${ref} up to ${commit}?`,
      { modal: true, detail: "This writes a drift-ack: line on the requirement. Findings from that commit and earlier ones stop showing; commit the change to share it." },
      "Acknowledge",
    );
    if (choice !== "Acknowledge") return undefined;
  }
  const result = await ackDrift(deps.fs, deps.git, service.tree, ref, commit);
  if (result.ok) void vscode.window.showInformationMessage(`Specflow: acknowledged drift on ${ref} up to ${result.value.commit.slice(0, 7)}.`);
  else void vscode.window.showErrorMessage(`Specflow: ${result.error.message}`);
  return result;
}
