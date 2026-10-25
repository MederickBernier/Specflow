import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { isWorkbenchTab, type WorkbenchTab, workbenchHtml } from "./html.js";

/** View type of the workbench panel, also used to restore it after a reload. */
export const workbenchViewType = "specflow.workbench";

/** Options of `specflow.openWorkbench`. */
export type OpenWorkbenchOptions = { tab?: WorkbenchTab };

/**
 * The Specflow workbench (workbench-ui/R1): one editor tab, created once and
 * revealed afterwards. The page saves its own tab with `setState`, so it
 * comes back on the same tab when hidden and shown or after a reload.
 */
export class WorkbenchPanel implements vscode.Disposable, vscode.WebviewPanelSerializer {
  readonly #extensionUri: vscode.Uri;
  #panel: vscode.WebviewPanel | undefined;
  #tab: WorkbenchTab | undefined;

  constructor(extensionUri: vscode.Uri) {
    this.#extensionUri = extensionUri;
  }

  /** The open panel, if any. */
  get panel(): vscode.WebviewPanel | undefined {
    return this.#panel;
  }

  /** The tab the page reports showing; undefined until its script has run. */
  get tab(): WorkbenchTab | undefined {
    return this.#tab;
  }

  /** Opens the workbench, or reveals it; `tab` switches to that tab. */
  open(options: OpenWorkbenchOptions = {}): vscode.WebviewPanel {
    const tab = isWorkbenchTab(options.tab) ? options.tab : undefined;
    if (this.#panel) {
      this.#panel.reveal();
      if (tab) void this.#panel.webview.postMessage({ type: "show", tab });
      return this.#panel;
    }
    const panel = vscode.window.createWebviewPanel(workbenchViewType, "Specflow", vscode.ViewColumn.Active, this.#options());
    this.#attach(panel, tab);
    return panel;
  }

  /** Restores the panel VS Code kept open across a reload. */
  async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
    if (this.#panel) {
      panel.dispose();
      return;
    }
    panel.webview.options = this.#options();
    this.#attach(panel);
  }

  dispose(): void {
    this.#panel?.dispose();
  }

  #options(): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.#extensionUri, "dist")] };
  }

  #attach(panel: vscode.WebviewPanel, tab?: WorkbenchTab): void {
    this.#panel = panel;
    this.#tab = undefined;
    const asset = (path: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(this.#extensionUri, "dist", path)).toString();
    panel.webview.html = workbenchHtml(
      { cspSource: panel.webview.cspSource, script: asset("webview.js"), style: asset("webview.css"), codicons: asset("codicons/codicon.css") },
      randomBytes(16).toString("base64"),
      tab,
    );
    panel.webview.onDidReceiveMessage((message: { type?: unknown; tab?: unknown }) => {
      if (message?.type === "tab" && isWorkbenchTab(message.tab)) this.#tab = message.tab;
    });
    panel.onDidDispose(() => {
      if (this.#panel !== panel) return;
      this.#panel = undefined;
      this.#tab = undefined;
    });
  }
}
