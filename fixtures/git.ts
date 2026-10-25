// Git for fixture builders: fixed identity and dates, and none of the user's
// global or system config, so builds are reproducible on every machine.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Environment for fixture git commands in `outDir`, committing at `date`. */
export function gitEnv(outDir: string, date = "2026-01-01T00:00:00Z"): NodeJS.ProcessEnv {
  // An empty file works on every OS, where /dev/null does not.
  const globalConfig = join(outDir, ".gitconfig");
  writeFileSync(globalConfig, "");
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
    GIT_COMMITTER_DATE: date,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

/** Runs git in `cwd` without a shell. */
export function git(cwd: string, env: NodeJS.ProcessEnv, args: string[], input?: string): string {
  return execFileSync(
    "git",
    ["-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args],
    { cwd, env, encoding: "utf8", ...(input !== undefined && { input }) },
  );
}
