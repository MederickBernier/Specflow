// Launches VS Code with the extension and runs the smoke tests in it, once per
// workspace: one with specs, one without (vscode-extension/R1).
//
//   pnpm --filter specflow-vscode test:smoke
//
// Needs a display; on Linux CI wrap it in xvfb-run.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

// Started from a VS Code terminal, these would make the test VS Code run as plain Node or talk to the outer window.
for (const name of Object.keys(process.env)) {
  if (name === "ELECTRON_RUN_AS_NODE") delete process.env[name];
}

const here = fileURLToPath(new URL(".", import.meta.url));
// SPECFLOW_EXTENSION_PATH points at an unpacked .vsix, to test the packaged extension.
const extensionDevelopmentPath = process.env.SPECFLOW_EXTENSION_PATH ? resolve(process.env.SPECFLOW_EXTENSION_PATH) : resolve(here, "..");
const extensionTestsPath = resolve(here, "../dist-test/smoke.js");
const cleanFixture = resolve(here, "../../../fixtures/repos/clean");
const driftFixture = resolve(here, "../../../fixtures/repos/drift-code-changed-since-spec");

// Copies, so tests may edit spec files.
const scratch = mkdtempSync(join(tmpdir(), "specflow-smoke-"));
const withSpecs = join(scratch, "clean");
const withoutSpecs = join(scratch, "empty");
cpSync(cleanFixture, withSpecs, { recursive: true });
cpSync(join(cleanFixture, "src"), join(withoutSpecs, "src"), { recursive: true });
const withDrift = join(scratch, "drift");
cpSync(driftFixture, withDrift, { recursive: true });
// Windows runners set core.autocrlf=true globally; files git restores would then differ from `git show` by their line endings.
for (const repo of [withSpecs, withDrift]) execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: repo });

try {
  for (const [label, workspace] of [
    ["with-specs", withSpecs],
    ["without-specs", withoutSpecs],
    ["drift", withDrift],
  ] as const) {
    console.log(`smoke: ${label}`);
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes"],
      extensionTestsEnv: { SPECFLOW_SMOKE: label, ...(process.env.CI && { CI: process.env.CI }) },
    });
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
