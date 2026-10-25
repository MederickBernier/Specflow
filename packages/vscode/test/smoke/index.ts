// Smoke tests that run inside VS Code (see test/run.ts). No test framework:
// each test is an async function; the first failure rejects `run`.

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

const extensionId = "specflow.specflow-vscode";
const tests: [string, () => Promise<void>][] = [];
const test = (name: string, body: () => Promise<void>) => tests.push([name, body]);

const extension = () => {
  const found = vscode.extensions.getExtension(extensionId);
  assert.ok(found, `${extensionId} is installed`);
  return found;
};

/** Waits for `check` to pass, polling, since activation is asynchronous. */
async function eventually(check: () => boolean | Promise<boolean>, what: string, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`timed out waiting for ${what}`);
}

if (process.env.SPECFLOW_SMOKE === "with-specs") {
  // vscode-extension/R1: a workspace with .specs/ activates the extension.
  test("activates on a workspace with specs", async () => {
    await eventually(() => extension().isActive, "activation");
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("specflow.init"));
  });

  test("refuses to initialize over existing specs", async () => {
    await vscode.commands.executeCommand("specflow.init");
    const product = await vscode.workspace.findFiles(".specs/product.md");
    assert.equal(product.length, 1);
  });
} else {
  // vscode-extension/R1: without specs nothing activates until Initialize specs runs.
  test("does not activate on a workspace without specs", async () => {
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(extension().isActive, false);
  });

  test("Initialize specs activates the extension and creates .specs/", async () => {
    const result = await vscode.commands.executeCommand("specflow.init");
    assert.equal(extension().isActive, true);
    assert.equal((result as { ok: boolean }).ok, true, JSON.stringify(result));
    // Read the disk directly; the search index can lag behind new files.
    const root = vscode.workspace.workspaceFolders![0]!.uri;
    const list = async (dir: vscode.Uri, prefix: string): Promise<string[]> => {
      const entries = await vscode.workspace.fs.readDirectory(dir);
      const nested = await Promise.all(
        entries.map(([name, type]) =>
          type === vscode.FileType.Directory ? list(vscode.Uri.joinPath(dir, name), `${prefix}${name}/`) : [`${prefix}${name}`],
        ),
      );
      return nested.flat();
    };
    const created = (await list(vscode.Uri.joinPath(root, ".specs"), ".specs/")).sort();
    assert.deepEqual(created, [
      ".specs/config.yml",
      ".specs/example/design.md",
      ".specs/example/requirements.md",
      ".specs/example/tasks.md",
      ".specs/product.md",
      ".specs/README.md",
      ".specs/tech.md",
    ].sort());
  });
}

/** Entry point called by VS Code's test runner. */
export async function run(): Promise<void> {
  for (const [name, body] of tests) {
    try {
      await body();
      console.log(`  ok   ${name}`);
    } catch (error) {
      console.log(`  FAIL ${name}`);
      throw error;
    }
  }
}
