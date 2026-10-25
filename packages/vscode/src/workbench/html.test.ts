import { describe, expect, it } from "vitest";
import { isWorkbenchTab, workbenchHtml, workbenchTabs } from "./html.js";

const assets = {
  cspSource: "https://file+.vscode-resource.vscode-cdn.net",
  script: "https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview.js",
  style: "https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview.css",
  codicons: "https://file+.vscode-resource.vscode-cdn.net/ext/dist/codicons/codicon.css",
};

function csp(html: string): string {
  return /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)![1]!;
}

describe("workbenchHtml (workbench-ui/R1)", () => {
  it("allows only local resources and the nonced script", () => {
    const policy = csp(workbenchHtml(assets, "abc123"));
    expect(policy.split("; ")).toEqual([
      "default-src 'none'",
      "script-src 'nonce-abc123'",
      `style-src ${assets.cspSource}`,
      `font-src ${assets.cspSource}`,
      `img-src ${assets.cspSource} data:`,
    ]);
    expect(policy).not.toContain("unsafe");
    expect(policy).not.toMatch(/https?:\/\/(?!file\+\.vscode-resource)/);
  });

  it("loads the bundle with the nonce and no inline script", () => {
    const html = workbenchHtml(assets, "abc123");
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]![0]).toContain(`nonce="abc123" src="${assets.script}"`);
    expect(scripts[0]![1]).toBe("");
    expect(html).toContain(`href="${assets.style}"`);
    expect(html).toContain(`href="${assets.codicons}"`);
    expect(html).not.toContain("<style");
  });

  it("passes the requested tab as a hint", () => {
    expect(workbenchHtml(assets, "n", "drift")).toContain('<div id="app" data-tab="drift">');
    expect(workbenchHtml(assets, "n")).toContain('<div id="app"></div>');
  });
});

describe("workbench tabs", () => {
  it("are the five tabs, in order", () => {
    expect(workbenchTabs).toEqual(["overview", "board", "review", "trace", "drift"]);
  });

  it("recognizes only known tabs", () => {
    expect(isWorkbenchTab("board")).toBe(true);
    expect(isWorkbenchTab("settings")).toBe(false);
    expect(isWorkbenchTab(undefined)).toBe(false);
  });
});
