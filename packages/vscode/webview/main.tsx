import { render } from "preact";
import { isWorkbenchTab } from "../src/workbench/html.ts";
import { App } from "./app.tsx";
import "./style.css";
import { vscodeApi } from "./vscode-api.ts";

const root = document.getElementById("app")!;
const hint = root.dataset.tab;
render(<App api={vscodeApi()} {...(isWorkbenchTab(hint) && { initialTab: hint })} />, root);
