// Builds the drift fixture repos described in scenarios.ts.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git, gitEnv } from "../git.ts";
import { driftScenarios, type Hashes } from "./scenarios.ts";

/** Builds every scenario into `<outDir>/drift-<name>`, one commit per step, a day apart. Returns name -> path. */
export function buildDriftFixtures(outDir: string): Record<string, string> {
  const built: Record<string, string> = {};
  for (const scenario of driftScenarios) {
    const name = `drift-${scenario.name}`;
    const dest = join(outDir, name);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    git(dest, gitEnv(outDir), ["init", "--quiet"]);

    const hashes: Hashes = {};
    scenario.steps.forEach((step, index) => {
      const env = gitEnv(outDir, `2026-02-${String(index + 1).padStart(2, "0")}T09:00:00Z`);
      for (const [path, content] of Object.entries(step.files)) {
        const file = join(dest, path);
        if (content === null) {
          rmSync(file, { force: true });
        } else {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, typeof content === "function" ? content(hashes) : content);
        }
      }
      git(dest, env, ["add", "--all"]);
      git(dest, env, ["commit", "--quiet", "--file", "-"], step.message);
      if (step.name) hashes[step.name] = git(dest, env, ["rev-parse", "HEAD"]).trim();
    });
    built[name] = dest;
  }
  return built;
}
