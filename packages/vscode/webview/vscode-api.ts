import type { WorkbenchTab } from "../src/workbench/html.ts";
import type { DiffLayout } from "./diff-view.tsx";
import type { FeatureRef } from "./overview.tsx";

/** What the page saves with `setState`: restored when it is shown again or after a reload. */
export type PageState = { tab?: WorkbenchTab; filter?: FeatureRef; diffLayout?: DiffLayout };

/** The part of `acquireVsCodeApi()` the page uses; tests pass a fake. */
export type WebviewApi = {
  postMessage(message: unknown): void;
  getState(): PageState | undefined;
  setState(state: PageState): void;
};

declare function acquireVsCodeApi(): WebviewApi;

/** The real API, which VS Code allows to be acquired once per page. */
export function vscodeApi(): WebviewApi {
  return acquireVsCodeApi();
}
