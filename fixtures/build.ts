// Builds fixture git repos from fixtures/specs/ into fixtures/repos/.
//
// `specs/clean` is a complete, lint-clean repo. Every other folder is an
// overlay copied on top of `clean` that breaks exactly one lint rule, and is
// named after that rule. Commits use a fixed identity and date so builds are
// reproducible.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, "specs");
const baseFixture = "clean";

/** Default output folder, gitignored. */
export const reposDir = join(here, "repos");

const fixedDate = "2026-01-01T00:00:00Z";

// The user's global and system git config never apply. An empty file works on
// every OS, where /dev/null does not.
function gitEnv(outDir: string): NodeJS.ProcessEnv {
  const globalConfig = join(outDir, ".gitconfig");
  writeFileSync(globalConfig, "");
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_AUTHOR_DATE: fixedDate,
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
    GIT_COMMITTER_DATE: fixedDate,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

function git(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args],
    { cwd, env, encoding: "utf8" },
  );
}

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

/** Deletes `outDir` and rebuilds every fixture repo in it. Returns name -> path. */
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
    git(dest, env, "init", "--quiet");
    git(dest, env, "add", "--all");
    git(dest, env, "commit", "--quiet", "--message", `fixture: ${name}`);
    built[name] = dest;
  }
  return built;
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
