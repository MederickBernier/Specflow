import * as vscode from "vscode";
import { type ExplorerNode, explorerNodes, type ExplorerSource } from "./explorer-nodes.js";

/** The Specs view in the Explorer: features, requirements and tasks (vscode-extension/R2). */
export class SpecExplorer implements vscode.TreeDataProvider<ExplorerNode> {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#changed.event;
  readonly #sources: () => ExplorerSource[];

  constructor(sources: () => ExplorerSource[]) {
    this.#sources = sources;
  }

  /** Re-reads the sources; call when a spec tree changed. */
  refresh(): void {
    this.#changed.fire();
  }

  getChildren(node?: ExplorerNode): ExplorerNode[] {
    return node ? node.children : explorerNodes(this.#sources());
  }

  getTreeItem(node: ExplorerNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children.length === 0
        ? vscode.TreeItemCollapsibleState.None
        : node.kind === "root"
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = node.id;
    item.iconPath = new vscode.ThemeIcon(node.icon);
    item.contextValue = node.kind;
    if (node.description) item.description = node.description;
    if (node.tooltip) item.tooltip = node.tooltip;
    if (node.location) {
      const line = Math.max(0, node.location.startLine - 1);
      item.command = {
        command: "vscode.open",
        title: "Open",
        arguments: [vscode.Uri.file(node.location.file), { selection: new vscode.Range(line, 0, line, 0) }],
      };
    }
    return item;
  }

  dispose(): void {
    this.#changed.dispose();
  }
}
