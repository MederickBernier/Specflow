// Benchmark for drift-check/R8: the rule-based pass over a repo with 5,000
// commits and 200 requirements must finish in under 5 seconds.
//
//   pnpm build && node bench/drift.bench.ts
//
// The repo is generated with `git fast-import` from a seeded PRNG, so every
// run measures the same history.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDrift, loadSpecTree, toPosixPath } from "../packages/core/dist/index.js";
import { NodeFileSystem, NodeGit } from "../packages/core/dist/node/index.js";

const features = 10;
const perFeature = 20;
const totalCommits = 5_000;
const budgetMs = 5_000;

// Mulberry32: small, fast and deterministic.
let seed = 42;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (n: number) => Math.floor(random() * n);

const requirements = (feature: number, revisions: number[]) =>
  [`# f${feature}: requirements\n`]
    .concat(
      Array.from({ length: perFeature }, (_, r) =>
        `## R${r + 1}: Requirement ${r + 1}\npriority: must\nstatus: approved\n\n- Given state ${r}\n- When action ${r}\n- Then outcome ${r}, revision ${revisions[r]}\n`,
      ),
    )
    .join("\n");

const tasks = (feature: number) =>
  [`# f${feature}: tasks\n`]
    .concat(
      Array.from({ length: perFeature }, (_, r) => `## T${r + 1}: Task ${r + 1} [R${r + 1}]\nstatus: done\nfiles: src/f${feature}/r${r + 1}.ts\n`),
    )
    .join("\n");

function stream(): string {
  const out: string[] = [];
  let mark = 0;
  let time = Date.UTC(2024, 0, 1) / 1000;
  const revisions = Array.from({ length: features }, () => Array<number>(perFeature).fill(0));
  const commit = (message: string, files: [string, string][]) => {
    time += 3600;
    out.push(`commit refs/heads/main\nmark :${++mark}\nauthor Bench <bench@example.com> ${time} +0000\ncommitter Bench <bench@example.com> ${time} +0000\n`);
    out.push(`data ${Buffer.byteLength(message)}\n${message}\n`);
    if (mark > 1) out.push(`from :${mark - 1}\n`);
    for (const [path, content] of files) out.push(`M 100644 inline ${path}\ndata ${Buffer.byteLength(content)}\n${content}\n`);
  };
  const trailers = (f: number, r: number) => `\n\nSpec-Feature: f${f}\nSpec-Task: T${r}\nSpec-Req: R${r}\n`;

  const specFiles: [string, string][] = [[".specs/config.yml", "version: 1\n"]];
  for (let f = 0; f < features; f++) {
    specFiles.push([`.specs/f${f}/requirements.md`, requirements(f, revisions[f]!)], [`.specs/f${f}/tasks.md`, tasks(f)]);
  }
  commit("docs(specs): all features", specFiles);

  for (let f = 0; f < features; f++) {
    for (let r = 1; r <= perFeature; r++) {
      commit(`feat(f${f}): Task ${r}${trailers(f, r)}`, [[`src/f${f}/r${r}.ts`, `export const v = ${r};\n`]]);
    }
  }

  while (mark < totalCommits) {
    const f = pick(features);
    const r = pick(perFeature) + 1;
    const roll = random();
    if (roll < 0.05) {
      revisions[f]![r - 1]!++;
      commit(`docs(specs): revise f${f}/R${r}`, [[`.specs/f${f}/requirements.md`, requirements(f, revisions[f]!)]]);
    } else if (roll < 0.5) {
      commit(`feat(f${f}): Task ${r} again${trailers(f, r)}`, [[`src/f${f}/r${r}.ts`, `export const v = ${mark};\n`]]);
    } else {
      commit(`chore: tweak f${f} r${r}`, [[`src/f${f}/r${r}.ts`, `export const v = ${mark}; // tweak\n`]]);
    }
  }
  return out.join("");
}

const dir = toPosixPath(mkdtempSync(join(tmpdir(), "specflow-bench-")));
try {
  const generated = Date.now();
  execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: dir });
  execFileSync("git", ["fast-import", "--quiet"], { cwd: dir, input: stream(), maxBuffer: 1 << 30 });
  execFileSync("git", ["checkout", "--quiet", "main"], { cwd: dir });
  const commits = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  console.log(`generated ${commits} commits in ${Date.now() - generated} ms`);

  const tree = await loadSpecTree(new NodeFileSystem(), dir);
  if (!tree.ok) throw new Error(tree.error.message);
  const count = tree.value.features.reduce((n, f) => n + f.requirements.length, 0);

  const start = performance.now();
  const result = await checkDrift(new NodeGit({ cwd: dir }), tree.value);
  const elapsed = Math.round(performance.now() - start);
  if (!result.ok) throw new Error(result.error.message);

  console.log(`drift: ${count} requirements, ${result.value.length} findings, ${elapsed} ms (budget ${budgetMs} ms)`);
  process.exitCode = elapsed < budgetMs ? 0 : 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
