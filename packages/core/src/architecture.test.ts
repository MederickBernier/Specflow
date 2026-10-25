import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// tech.md: core never imports vscode, never spawns processes, never reads
// environment variables. Only core/node holds I/O implementations, and
// nothing else in core imports it.
const srcDir = fileURLToPath(new URL(".", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node" ? [] : sources(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("core architecture", () => {
  const files = sources(srcDir).map((path) => ({ path: relative(srcDir, path), text: readFileSync(path, "utf8") }));

  it("finds the core sources", () => {
    expect(files.map((f) => f.path)).toContain("load.ts");
  });

  it.each([
    ["imports core/node", /from\s+["'](\.\.?\/)+node(\/[^"']*)?["']/],
    ["imports vscode", /from\s+["']vscode["']/],
    ["imports child_process", /from\s+["'](node:)?child_process["']/],
    ["reads process.env", /process\.env/],
  ])("no module outside core/node %s", (_name, pattern) => {
    expect(files.filter((f) => pattern.test(f.text)).map((f) => f.path)).toEqual([]);
  });
});
