import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { Debouncer } from "../debounce.js";
import { isWorkbenchTab, type WorkbenchTab, workbenchHtml } from "./html.js";
import { type HostMessage, type PageMessage, parsePageMessage, type WorkbenchState } from "./protocol.js";
import { buildWorkbenchState, type WorkbenchInputs } from "./state.js";

/** View type of the workbench panel, also used to restore it after a reload. */
export const workbenchViewType = "specflow.workbench";

/** How long after the last change a new state is posted; well inside workbench-ui/R1's 1 second. */
export const stateDebounceMs = 100;

/** Options of `specflow.openWorkbench`. */
export type OpenWorkbenchOptions = { tab?: WorkbenchTab };

/** A page message that asks the extension to do something, for the tabs' actions. */
export type WorkbenchIntent = Exclude<PageMessage, { type: "ready" | "tab" | "rendered" }>;

/**
 * The Specflow workbench (workbench-ui/R1): one editor tab, created once and
 * revealed afterwards. The page saves its own tab with `setState`, so it
 * comes back on the same tab when hidden and shown or after a reload.
 *
 * The extension owns the state: `changed()` posts a fresh snapshot, debounced,
 * and the page answers with what it rendered. Page messages are validated
 * against the last snapshot; intents go to `onDidRequest`.
 */
export class WorkbenchPanel implements vscode.Disposable, vscode.WebviewPanelSerializer {
  readonly #extensionUri: vscode.Uri;
  readonly #inputs: () => WorkbenchInputs;
  readonly #post = new Debouncer(stateDebounceMs, () => this.#postState());
  readonly #requests = new vscode.EventEmitter<WorkbenchIntent>();
  readonly onDidRequest = this.#requests.event;
  #panel: vscode.WebviewPanel | undefined;
  #tab: WorkbenchTab | undefined;
  #state: WorkbenchState | undefined;
  #rendered: number | undefined;
  #revision = 0;

  constructor(extensionUri: vscode.Uri, inputs: () => WorkbenchInputs) {
    this.#extensionUri = extensionUri;
    this.#inputs = inputs;
  }

  /** The open panel, if any. */
  get panel(): vscode.WebviewPanel | undefined {
    return this.#panel;
  }

  /** The tab the page reports showing; undefined until its script has run. */
  get tab(): WorkbenchTab | undefined {
    return this.#tab;
  }

  /** The last state posted to the page. */
  get state(): WorkbenchState | undefined {
    return this.#state;
  }

  /** The revision the page last reported rendering. */
  get rendered(): number | undefined {
    return this.#rendered;
  }

  /** Something the workbench shows changed; the open page gets a new state shortly. */
  changed(): void {
    if (this.#panel) this.#post.trigger();
  }

  /** Opens the workbench, or reveals it; `tab` switches to that tab. */
  open(options: OpenWorkbenchOptions = {}): vscode.WebviewPanel {
    const tab = isWorkbenchTab(options.tab) ? options.tab : undefined;
    if (this.#panel) {
      this.#panel.reveal();
      if (tab) this.send({ type: "show", tab });
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

  /** Handles a message as if the page had posted it; also used by the smoke tests. */
  receive(raw: unknown): PageMessage | undefined {
    const message = parsePageMessage(raw, this.#state);
    if (!message) return undefined;
    switch (message.type) {
      case "ready":
        this.#post.dispose();
        this.#postState();
        break;
      case "tab":
        this.#tab = message.tab;
        break;
      case "rendered":
        this.#rendered = message.revision;
        break;
      default:
        this.#requests.fire(message);
    }
    return message;
  }

  dispose(): void {
    this.#post.dispose();
    this.#panel?.dispose();
    this.#requests.dispose();
  }

  #options(): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.#extensionUri, "dist")] };
  }

  #postState(): void {
    if (!this.#panel) return;
    this.#state = buildWorkbenchState(this.#inputs(), ++this.#revision);
    this.send({ type: "state", state: this.#state });
  }

  /** Posts a message to the open page, if any. */
  send(message: HostMessage): void {
    void this.#panel?.webview.postMessage(message);
  }

  #attach(panel: vscode.WebviewPanel, tab?: WorkbenchTab): void {
    this.#panel = panel;
    this.#tab = undefined;
    this.#rendered = undefined;
    // Validation needs a state before the page's first message.
    this.#state = buildWorkbenchState(this.#inputs(), ++this.#revision);
    const asset = (path: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(this.#extensionUri, "dist", path)).toString();
    panel.webview.html = workbenchHtml(
      { cspSource: panel.webview.cspSource, script: asset("webview.js"), style: asset("webview.css"), codicons: asset("codicons/codicon.css") },
      randomBytes(16).toString("base64"),
      tab,
    );
    panel.webview.onDidReceiveMessage((message: unknown) => this.receive(message));
    panel.onDidDispose(() => {
      if (this.#panel !== panel) return;
      this.#post.dispose();
      this.#panel = undefined;
      this.#tab = undefined;
      this.#rendered = undefined;
    });
  }
}
