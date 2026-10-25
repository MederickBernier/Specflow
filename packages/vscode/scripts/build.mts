// Bundles the extension host (Node) and the workbench webview (browser), and
// copies the codicon font next to them. `--minify` for packaging.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const minify = process.argv.includes("--minify");
const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");

await Promise.all([
  build({
    entryPoints: [join(root, "src/extension.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    sourcemap: !minify,
    minify,
    outfile: join(dist, "extension.js"),
  }),
  build({
    entryPoints: [join(root, "webview/main.tsx")],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "preact",
    sourcemap: !minify,
    minify,
    outdir: dist,
    entryNames: "webview",
  }),
]);

const codicons = join(dirname(createRequire(import.meta.url).resolve("@vscode/codicons/package.json")), "dist");
mkdirSync(join(dist, "codicons"), { recursive: true });
for (const file of ["codicon.css", "codicon.ttf"]) copyFileSync(join(codicons, file), join(dist, "codicons", file));
