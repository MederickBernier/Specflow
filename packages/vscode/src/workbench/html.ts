/** The workbench tabs, in display order (workbench-ui/R1). */
export const workbenchTabs = ["overview", "board", "review", "trace", "drift"] as const;
export type WorkbenchTab = (typeof workbenchTabs)[number];

export function isWorkbenchTab(value: unknown): value is WorkbenchTab {
  return typeof value === "string" && (workbenchTabs as readonly string[]).includes(value);
}

/** Webview URIs of the bundled assets, and the webview's CSP source. */
export type WorkbenchAssets = { cspSource: string; script: string; style: string; codicons: string };

/**
 * The workbench page: the bundle's script and styles only, under a CSP that
 * allows nothing but local resources and the one nonced script. The initial
 * tab is a hint; the page prefers the tab it saved itself.
 */
export function workbenchHtml(assets: WorkbenchAssets, nonce: string, tab?: WorkbenchTab): string {
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${assets.cspSource}`,
    `font-src ${assets.cspSource}`,
    `img-src ${assets.cspSource} data:`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${assets.codicons}">
<link rel="stylesheet" href="${assets.style}">
<title>Specflow</title>
</head>
<body>
<div id="app"${tab ? ` data-tab="${tab}"` : ""}></div>
<script nonce="${nonce}" src="${assets.script}"></script>
</body>
</html>`;
}
