import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// workbench-ui/R1: the page imports host types only. A value import of
// protocol.ts or core once pulled zod into the page and grew it from 40 KB to
// 500 KB; this keeps it small.
describe("workbench page bundle", () => {
  it("stays small and contains no host code", async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL("../webview/main.tsx", import.meta.url))],
      bundle: true,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      jsxImportSource: "preact",
      minify: true,
      write: false,
      metafile: true,
      loader: { ".css": "empty" },
      logLevel: "silent",
    });
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.filter((path) => /node_modules\/(zod|yaml|mdast|micromark)|packages\/core\//.test(path))).toEqual([]);
    expect(result.outputFiles[0]!.contents.length).toBeLessThan(100_000);
  });
});
