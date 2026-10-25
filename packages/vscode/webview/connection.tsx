import { useEffect, useState } from "preact/hooks";
import type { WorkbenchTab } from "../src/workbench/html.ts";
import type { HostMessage, WorkbenchState } from "../src/workbench/protocol.ts";
import { App } from "./app.tsx";
import type { WebviewApi } from "./vscode-api.ts";

/**
 * Connects the page to the extension (workbench-ui/R1): asks for the state on
 * load, since the page starts over each time it is shown, renders every state
 * the extension posts, and reports each revision once it is on screen.
 */
export function Connected({ api, initialTab }: { api: WebviewApi; initialTab?: WorkbenchTab }) {
  const [state, setState] = useState<WorkbenchState | undefined>(undefined);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as HostMessage | undefined;
      if (message?.type === "state" && message.state) setState(message.state);
    };
    window.addEventListener("message", onMessage);
    api.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (state) api.postMessage({ type: "rendered", revision: state.revision });
  }, [state]);

  return <App api={api} {...(initialTab && { initialTab })} {...(state && { state })} />;
}
