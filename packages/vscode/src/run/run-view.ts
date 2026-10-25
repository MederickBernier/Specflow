import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { renderBody, type RunViewState } from "./run-view-model.js";

/**
 * The webview showing one run's events (vscode-extension/R4). Plain HTML and
 * a message handler, no framework. The Cancel button posts `cancel`.
 */
export class RunView implements vscode.Disposable {
  readonly #panel: vscode.WebviewPanel;
  readonly #cancel = new vscode.EventEmitter<void>();
  readonly onDidRequestCancel = this.#cancel.event;
  #disposed = false;

  constructor(state: RunViewState) {
    this.#panel = vscode.window.createWebviewPanel("specflow.run", state.title, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true });
    this.#panel.webview.html = shell(this.#panel.webview, renderBody(state));
    this.#panel.webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message?.type === "cancel") this.#cancel.fire();
    });
    this.#panel.onDidDispose(() => {
      this.#disposed = true;
      this.#cancel.dispose();
    });
  }

  update(state: RunViewState): void {
    if (!this.#disposed) void this.#panel.webview.postMessage({ type: "render", html: renderBody(state) });
  }

  dispose(): void {
    if (!this.#disposed) this.#panel.dispose();
  }
}

function shell(webview: vscode.Webview, body: string): string {
  const nonce = randomBytes(16).toString("base64");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 12px; }
  header { display: flex; align-items: center; gap: 12px; }
  h1 { font-size: 1.1em; margin: 12px 0; }
  .status { color: var(--vscode-descriptionForeground); }
  .status.failed { color: var(--vscode-errorForeground); }
  button { margin-left: auto; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; padding: 4px 12px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  ol { list-style: none; padding: 0; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
  li { padding: 2px 0; white-space: pre-wrap; }
  li.message { font-family: var(--vscode-font-family); padding: 6px 0; }
  li.tool, li.command { color: var(--vscode-descriptionForeground); }
  li.warning { color: var(--vscode-editorWarning-foreground); }
  li.error { color: var(--vscode-errorForeground); }
  .outcome { border-top: 1px solid var(--vscode-panel-border); padding-top: 8px; }
  footer { color: var(--vscode-descriptionForeground); margin: 12px 0; }
</style>
</head>
<body>
<main id="root">${body}</main>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "render") document.getElementById("root").innerHTML = event.data.html;
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-action=cancel]")) vscode.postMessage({ type: "cancel" });
  });
</script>
</body>
</html>`;
}
