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

  // vscode-extension/R2: saving a spec file reloads the tree once, within 1 second.
  test("reloads the spec tree once after spec files are saved", async () => {
    await eventually(() => extension().isActive, "activation");
    const api = extension().exports as { services: () => { tree?: { features: { name: string; tasks: { id: string }[] }[] }; onDidChange: vscode.Event<unknown> }[] };
    const [service] = api.services();
    assert.ok(service?.tree, "tree loaded");
    let changes = 0;
    const listener = service.onDidChange(() => changes++);

    const root = vscode.workspace.workspaceFolders![0]!.uri;
    const tasks = vscode.Uri.joinPath(root, ".specs/accounts/tasks.md");
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(tasks));
    const started = Date.now();
    await vscode.workspace.fs.writeFile(tasks, new TextEncoder().encode(`${text}\n## T4: Added in a smoke test []\n`));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, ".specs/accounts/design.md"), new TextEncoder().encode("# changed\n"));

    await eventually(() => changes > 0, "onDidChange", 1000);
    const elapsed = Date.now() - started;
    await new Promise((r) => setTimeout(r, 600));
    listener.dispose();
    assert.equal(changes, 1, "one change event for the burst");
    assert.ok(elapsed < 1000, `refreshed in ${elapsed} ms`);
    const accounts = service.tree!.features.find((f) => f.name === "accounts")!;
    assert.deepEqual(accounts.tasks.map((t) => t.id), ["T1", "T2", "T3", "T4"]);
  });

  // vscode-extension/R2: the explorer shows features, requirements and tasks; clicking opens the line.
  test("shows the spec tree in the explorer and opens items at their line", async () => {
    type Node = { label: string; children: Node[] };
    const api = extension().exports as {
      explorer: { getChildren: (n?: Node) => Node[]; getTreeItem: (n: Node) => vscode.TreeItem };
    };
    const features = api.explorer.getChildren();
    assert.deepEqual(features.map((f) => f.label), ["accounts", "billing"]);
    const accounts = api.explorer.getChildren(features[0]);
    assert.deepEqual(accounts.slice(0, 2).map((n) => n.label), ["R1: Sign in with email", "R2: Lock out after failed attempts"]);
    const t3 = accounts.find((n) => n.label === "T3: Add lockout counter")!;
    const item = api.explorer.getTreeItem(t3);
    assert.equal((item.iconPath as vscode.ThemeIcon).id, "circle-large-outline");

    await vscode.commands.executeCommand(item.command!.command, ...item.command!.arguments!);
    const editor = vscode.window.activeTextEditor!;
    assert.ok(editor.document.uri.fsPath.endsWith("tasks.md"));
    assert.equal(editor.document.lineAt(editor.selection.active.line).text, "## T3: Add lockout counter [R2]");
  });

  // vscode-extension/R3: lint findings appear on the right file and line, and clear when fixed.
  test("shows lint findings in Problems and clears them once fixed", async () => {
    const root = vscode.workspace.workspaceFolders![0]!.uri;
    const billing = vscode.Uri.joinPath(root, ".specs/billing/tasks.md");
    const original = new TextDecoder().decode(await vscode.workspace.fs.readFile(billing));
    const specflow = () => vscode.languages.getDiagnostics(billing).filter((d) => d.source === "specflow");
    assert.deepEqual(specflow(), []);

    await vscode.workspace.fs.writeFile(billing, new TextEncoder().encode(original.replace("[R1]", "[R1, R7]")));
    await eventually(() => specflow().length === 1, "unknown-ref diagnostic", 3000);
    const [diagnostic] = specflow();
    assert.equal(diagnostic!.code, "unknown-ref");
    assert.equal(diagnostic!.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(diagnostic!.range.start.line, 2);
    assert.match(diagnostic!.message, /unknown requirement R7/);

    await vscode.workspace.fs.writeFile(billing, new TextEncoder().encode(original));
    await eventually(() => specflow().length === 0, "diagnostic cleared", 3000);
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

  test("Initialize specs activates the extension, creates .specs/ and starts watching it", async () => {
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
    const api = extension().exports as { services: () => { tree?: { features: { name: string }[] } }[] };
    assert.deepEqual(api.services()[0]?.tree?.features.map((f) => f.name), ["example"]);
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
