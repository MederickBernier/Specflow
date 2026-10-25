import { render } from "preact";
import { isWorkbenchTab } from "../src/workbench/html.ts";
import { Connected } from "./connection.tsx";
import "./style.css";
import { vscodeApi } from "./vscode-api.ts";

const root = document.getElementById("app")!;
const hint = root.dataset.tab;
render(<Connected api={vscodeApi()} {...(isWorkbenchTab(hint) && { initialTab: hint })} />, root);
