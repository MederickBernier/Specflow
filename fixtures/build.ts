// Builds fixture git repos from fixtures/specs/ into fixtures/repos/.
//
// `specs/clean` is a complete, lint-clean repo. Every other folder is an
// overlay copied on top of `clean` that breaks exactly one lint rule, and is
// named after that rule. Commits use a fixed identity and date so builds are
// reproducible. Drift fixtures (`drift-*`) are built from drift/scenarios.ts.

import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildDriftFixtures } from "./drift/build.ts";
import { git, gitEnv } from "./git.ts";

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, "specs");
const baseFixture = "clean";

/** Default output folder, gitignored. */
export const reposDir = join(here, "repos");

/** Names of all fixtures, `clean` included, in sorted order. */
export function fixtureNames(): string[] {
  return readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Absolute path of a built fixture repo. */
export function fixturePath(name: string, outDir: string = reposDir): string {
  return join(outDir, name);
}

/** Deletes `outDir` and rebuilds every fixture repo in it, drift fixtures included. Returns name -> path. */
export function buildFixtures(outDir: string = reposDir): Record<string, string> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const env = gitEnv(outDir);

  const built: Record<string, string> = {};
  for (const name of fixtureNames()) {
    const dest = fixturePath(name, outDir);
    cpSync(join(sourceDir, baseFixture), dest, { recursive: true });
    if (name !== baseFixture) {
      cpSync(join(sourceDir, name), dest, { recursive: true, force: true });
    }
    git(dest, env, ["init", "--quiet"]);
    git(dest, env, ["add", "--all"]);
    git(dest, env, ["commit", "--quiet", "--message", `fixture: ${name}`]);
    built[name] = dest;
  }
  return { ...built, ...buildDriftFixtures(outDir) };
}

/** Vitest global setup hook. */
export function setup(): void {
  buildFixtures();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [name, path] of Object.entries(buildFixtures())) {
    console.log(`${name}: ${path}`);
  }
}
