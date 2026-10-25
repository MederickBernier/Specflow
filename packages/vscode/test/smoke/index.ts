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

  // vscode-extension/R8: the check command reports the configured harness.
  test("checks the harness, honoring specflow.harness", async () => {
    const settings = vscode.workspace.getConfiguration("specflow");
    // User scope, so no .vscode/settings.json makes the tree dirty for the run tests.
    await settings.update("harness", "aider", vscode.ConfigurationTarget.Global);
    try {
      const result = (await vscode.commands.executeCommand("specflow.checkHarness")) as { ready: boolean; harness?: string };
      assert.deepEqual(result, { ready: false });
    } finally {
      await settings.update("harness", undefined, vscode.ConfigurationTarget.Global);
    }
    const result = (await vscode.commands.executeCommand("specflow.checkHarness")) as { harness?: string; check?: { ok: boolean } };
    assert.equal(result.harness, "claude-code");
    assert.equal(typeof result.check?.ok, "boolean");
  });

  // vscode-extension/R4: run a task, stream its events, cancel it.
  type Run = { target: string; state: { status: string; lines: { kind: string; text: string }[]; usage?: string; outcome?: string }; cancel: () => void };
  type Api = {
    registry: { register: (adapter: unknown) => void };
    runs: { current?: Run };
  };
  const smokeEvents = [
    { kind: "started", runId: "smoke", harness: "smoke", at: "2026-01-01T00:00:00Z" },
    { kind: "message", role: "assistant", text: "Looking at the lockout counter." },
    { kind: "tool-call", tool: "Read", summary: "src/auth/login.ts" },
    { kind: "usage", inputTokens: 1200, outputTokens: 300, costUsd: 0.004, durationMs: 2500 },
    { kind: "finished", ok: true, summary: "Nothing to change." },
  ];

  async function withRunSettings(body: () => Promise<void>) {
    const settings = vscode.workspace.getConfiguration("specflow");
    await settings.update("confirmRuns", false, vscode.ConfigurationTarget.Global);
    try {
      await body();
    } finally {
      await settings.update("confirmRuns", undefined, vscode.ConfigurationTarget.Global);
      await settings.update("harness", undefined, vscode.ConfigurationTarget.Global);
    }
  }

  test("runs a task and streams its events into the run view", async () => {
    const api = extension().exports as Api;
    api.registry.register({ name: "smoke", check: async () => ({ ok: true, value: { version: "1", warnings: [] } }), run: async function* () { yield* smokeEvents; } });
    await withRunSettings(async () => {
      await vscode.workspace.getConfiguration("specflow").update("harness", "smoke", vscode.ConfigurationTarget.Global);
      const result = (await vscode.commands.executeCommand("specflow.runTask", "accounts", "T3")) as { ok: boolean } | undefined;
      assert.equal(result?.ok, true);
      const state = api.runs.current!.state;
      assert.equal(state.status, "done");
      assert.deepEqual(state.lines, [
        { kind: "message", text: "Looking at the lockout counter." },
        { kind: "tool", text: "Read src/auth/login.ts" },
      ]);
      assert.equal(state.usage, "1,200 tokens in, 300 out, $0.00, 2.5 s");
      assert.match(state.outcome ?? "", /No files changed/);
      const tab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label === "Run accounts/T3");
      assert.ok(tab, "run view is open");
    });
  });

  test("cancels a running task", async () => {
    const api = extension().exports as Api;
    api.registry.register({
      name: "smoke-hang",
      check: async () => ({ ok: true, value: { version: "1", warnings: [] } }),
      run: async function* (_input: unknown, signal: AbortSignal) {
        yield smokeEvents[0];
        await new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve())));
        yield { kind: "finished", ok: false, cancelled: true };
      },
    });
    await withRunSettings(async () => {
      await vscode.workspace.getConfiguration("specflow").update("harness", "smoke-hang", vscode.ConfigurationTarget.Global);
      const pending = vscode.commands.executeCommand("specflow.runTask", "accounts", "T3") as Thenable<{ cancelled: boolean } | undefined>;
      await eventually(() => api.runs.current?.state.status === "running", "run started");
      await vscode.commands.executeCommand("specflow.cancelRun");
      const result = await pending;
      assert.equal(result?.cancelled, true);
      assert.equal(api.runs.current!.state.status, "cancelled");
    });
    const tasks = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, ".specs/accounts/tasks.md")));
    assert.match(tasks, /## T3: Add lockout counter \[R2\]\nstatus: todo/);
  });

  // vscode-extension/R5: review the changed files, accept with trailers, or discard.
  type Review = { pending?: unknown; files: () => { path: string; change: string }[] };
  const writer = (name: string, content: string) => ({
    name,
    check: async () => ({ ok: true, value: { version: "1", warnings: [] } }),
    run: async function* (input: { cwd: string }) {
      const nodeFs = await import("node:fs");
      yield { ...smokeEvents[0], harness: name };
      nodeFs.writeFileSync(`${input.cwd}/src/auth/login.ts`, content);
      yield { kind: "file-changed", path: "src/auth/login.ts", change: "modified" };
      nodeFs.writeFileSync(`${input.cwd}/src/auth/lockout.ts`, "export const attempts = 5;\n");
      yield { kind: "file-changed", path: "src/auth/lockout.ts", change: "added" };
      yield { kind: "finished", ok: true, summary: "Added the lockout counter." };
    },
  });
  const gitIn = async (...args: string[]) => {
    const { execFileSync } = await import("node:child_process");
    return execFileSync("git", args, { cwd: vscode.workspace.workspaceFolders![0]!.uri.fsPath, encoding: "utf8" });
  };

  test("reviews a staged run in the diff editor and accepts it with trailers", async () => {
    const api = extension().exports as Api & { review: Review };
    api.registry.register(writer("smoke-write", "export const login = () => 'changed';\n"));
    await gitIn("config", "user.name", "Smoke");
    await gitIn("config", "user.email", "smoke@example.com");
    await gitIn("config", "commit.gpgsign", "false");
    await withRunSettings(async () => {
      await vscode.workspace.getConfiguration("specflow").update("harness", "smoke-write", vscode.ConfigurationTarget.Global);
      const result = (await vscode.commands.executeCommand("specflow.runTask", "accounts", "T3")) as { recording?: { mode: string } };
      assert.equal(result.recording?.mode, "staged");
    });
    assert.deepEqual(api.review.files(), [
      { path: "src/auth/login.ts", change: "modified" },
      { path: "src/auth/lockout.ts", change: "added" },
      { path: ".specs/accounts/tasks.md", change: "modified" },
    ]);

    await vscode.commands.executeCommand("specflow.openDiff", "src/auth/login.ts");
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputTextDiff, "a diff editor is open");
    assert.equal(input.original.scheme, "specflow-head");
    assert.ok(input.modified.fsPath.endsWith("login.ts"));
    const head = await vscode.workspace.openTextDocument(input.original);
    assert.equal(head.getText(), "export function login(email: string, password: string): boolean {\n  return email.length > 0 && password === \"secret\";\n}\n");

    const commit = (await vscode.commands.executeCommand("specflow.acceptRun")) as string;
    assert.match(commit, /^[0-9a-f]{40}$/);
    assert.equal(await gitIn("log", "-1", "--format=%(trailers:key=Spec-Task,valueonly)"), "T3\n\n");
    assert.equal(api.review.pending, undefined);
  });

  test("discards a staged run, restoring files and the task status", async () => {
    const api = extension().exports as Api & { review: Review };
    api.registry.register(writer("smoke-write-2", "export const login = () => 'again';\n"));
    const before = await gitIn("show", "HEAD:src/auth/login.ts");
    const tasksBefore = await gitIn("show", "HEAD:.specs/accounts/tasks.md");
    // Accepting marked T3 done; run it again anyway to discard it.
    await withRunSettings(async () => {
      await vscode.workspace.getConfiguration("specflow").update("harness", "smoke-write-2", vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand("specflow.runTask", "accounts", "T3");
    });
    assert.ok(api.review.pending, "a run is under review");
    assert.equal(await vscode.commands.executeCommand("specflow.discardRun", { confirm: false }), true);
    const root = vscode.workspace.workspaceFolders![0]!.uri;
    assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, "src/auth/login.ts"))), before);
    assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ".specs/accounts/tasks.md"))), tasksBefore);
    assert.equal(await gitIn("diff", "--cached", "--name-only"), "");
  });

  // vscode-extension/R4, R7: lenses on task and requirement headings; the trace opens from them.
  test("shows run and summary lenses, and the trace behind a requirement", async () => {
    const api = extension().exports as { refreshInsights: () => Promise<void>; services: () => { root: string }[] };
    await api.refreshInsights();
    const root = vscode.workspace.workspaceFolders![0]!.uri;
    // executeCodeLensProvider only works on documents that are already open.
    const lensesOf = async (file: string) =>
      ((await vscode.commands.executeCommand("vscode.executeCodeLensProvider", (await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, file))).uri)) as vscode.CodeLens[])
        .filter((l) => l.command?.command.startsWith("specflow."))
        .map((l) => [l.range.start.line, l.command!.title, l.command!.command, l.command!.arguments]);

    const tasks = await lensesOf(".specs/accounts/tasks.md");
    assert.deepEqual(tasks[2], [15, "$(play) Run T3 again", "specflow.runTask", ["accounts", "T3"]]);

    const allRequirementLenses = await lensesOf(".specs/accounts/requirements.md");
    const requirements = allRequirementLenses.filter((l) => l[2] === "specflow.showTrace");
    assert.deepEqual(requirements[1]?.[0], 20);
    // workbench-ui/R5: each requirement also gets a lens opening its trace in the workbench.
    assert.deepEqual(
      allRequirementLenses.filter((l) => l[2] === "specflow.openWorkbench")[1],
      [20, "$(dashboard) Open in workbench", "specflow.openWorkbench", [{ tab: "trace", ref: "accounts/R2", root: api.services()[0]!.root }]],
    );
    assert.match(String(requirements[1]?.[1]), /^1 task · last commit \d{4}-\d{2}-\d{2} · (drift not checked|no drift|\d+ drift findings?)$/);
    assert.deepEqual(requirements[1]?.slice(2), ["specflow.showTrace", ["accounts/R2"]]);

    const items = (await vscode.commands.executeCommand("specflow.showTrace", "accounts/R2", { show: false })) as vscode.QuickPickItem[];
    assert.deepEqual(items.map((i) => i.label).slice(0, 3), ["Tasks", "accounts/T3", "Commits"]);
    assert.equal(items[3]?.label, "feat(accounts): Add lockout counter");
  });

  // vscode-extension/R9: lint and show from the palette.
  test("lints and shows items from the command palette", async () => {
    const findings = (await vscode.commands.executeCommand("specflow.lint")) as { rule: string }[];
    assert.deepEqual(findings.map((f) => f.rule), []);
    const location = (await vscode.commands.executeCommand("specflow.show", "accounts/R2")) as vscode.Location;
    assert.equal(location.range.start.line, 20);
    const editor = vscode.window.activeTextEditor!;
    assert.equal(editor.document.lineAt(editor.selection.active.line).text, "## R2: Lock out after failed attempts");
  });

  // workbench-ui/R1: one workbench tab, revealed on the second call; its page runs under the CSP.
  test("opens the workbench once and switches its tab on request", async () => {
    const workbenchTabs = () =>
      vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith("specflow.workbench"));
    const api = extension().exports as { workbench: { panel?: vscode.WebviewPanel; tab?: string } };
    await vscode.commands.executeCommand("specflow.openWorkbench");
    await eventually(() => api.workbench.tab === "overview", "the workbench page to report its tab");
    const html = api.workbench.panel!.webview.html;
    assert.match(html, /default-src 'none'; script-src 'nonce-[^']+'/);
    await vscode.commands.executeCommand("workbench.action.focusFirstEditorGroup");
    await vscode.commands.executeCommand("specflow.openWorkbench", { tab: "drift" });
    await eventually(() => api.workbench.tab === "drift", "the drift tab");
    assert.equal(workbenchTabs().length, 1);
    assert.equal(api.workbench.panel!.active, true);
  });

  type WorkbenchApi = {
    panel?: vscode.WebviewPanel;
    state?: { revision: number; roots: { features: { name: string; tasks: { id: string }[] }[] }[]; run?: { target: string } };
    rendered?: number;
    receive: (message: unknown) => unknown;
  };

  // workbench-ui/R3: Run on a board card goes through Specflow: Run task; Open shows the heading.
  test("runs and opens tasks from the board", async () => {
    type Workbench = { state?: { roots: { root: string }[]; run?: { target: string; status: string } }; receive: (message: unknown) => unknown };
    const api = extension().exports as Api & { workbench: Workbench };
    await eventually(() => api.workbench.state !== undefined, "the workbench state");
    const root = api.workbench.state!.roots[0]!.root;
    api.registry.register({ name: "smoke-board", check: async () => ({ ok: true, value: { version: "1", warnings: [] } }), run: async function* () { yield* smokeEvents; } });
    await withRunSettings(async () => {
      await vscode.workspace.getConfiguration("specflow").update("harness", "smoke-board", vscode.ConfigurationTarget.Global);
      assert.ok(api.workbench.receive({ type: "run", root, feature: "accounts", task: "T1" }), "the run intent is accepted");
      await eventually(() => api.runs.current?.target === "accounts/T1" && api.runs.current.state.status === "done", "the board's run to finish");
      await eventually(() => api.workbench.state?.run?.target === "accounts/T1" && api.workbench.state.run.status === "done", "the run in the workbench state");
    });

    assert.ok(api.workbench.receive({ type: "open", root, feature: "accounts", id: "R2" }));
    await eventually(() => vscode.window.activeTextEditor?.document.uri.path.endsWith(".specs/accounts/requirements.md") === true, "requirements.md to open");
    const editor = vscode.window.activeTextEditor!;
    assert.equal(editor.document.lineAt(editor.selection.active.line).text, "## R2: Lock out after failed attempts");
  });

  // workbench-ui/R4: the page asks for the run's diff, sees edits made during review, and accepts it.
  test("reviews a run inline in the workbench and accepts it", async () => {
    type Answer = { type: string; source?: string; files?: { path: string; hunks: { lines: { text: string }[] }[] }[] };
    type Workbench = {
      state?: { revision: number; roots: { root: string }[]; review?: { files: { path: string }[] } };
      receive: (message: unknown) => unknown;
      send: (message: unknown) => void;
    };
    const api = extension().exports as Api & { workbench: Workbench; review: Review };
    const sent: Answer[] = [];
    const send = api.workbench.send.bind(api.workbench);
    api.workbench.send = (message) => {
      sent.push(message as Answer);
      send(message);
    };
    const root = vscode.workspace.workspaceFolders![0]!.uri;
    const loginText = (answer: Answer | undefined) =>
      answer?.files?.find((f) => f.path === "src/auth/login.ts")?.hunks.flatMap((h) => h.lines.map((l) => l.text)).join("\n") ?? "";
    const lastReview = () => sent.filter((m) => m.type === "diff" && m.source === "review").at(-1);
    try {
      api.registry.register(writer("smoke-workbench", "export const login = () => 'from the workbench';\n"));
      await withRunSettings(async () => {
        await vscode.workspace.getConfiguration("specflow").update("harness", "smoke-workbench", vscode.ConfigurationTarget.Global);
        api.workbench.receive({ type: "run", root: api.workbench.state!.roots[0]!.root, feature: "accounts", task: "T3" });
        await eventually(() => api.review.pending !== undefined && api.workbench.state?.review !== undefined, "the run to be under review");
      });

      await vscode.commands.executeCommand("specflow.openWorkbench", { tab: "review" });
      await eventually(() => loginText(lastReview()).includes("from the workbench"), "the page to get the run's diff");
      // An earlier test committed lockout.ts and T3 is already done, so only login.ts differs from HEAD.
      assert.deepEqual(lastReview()!.files!.map((f) => f.path), ["src/auth/login.ts"]);
      assert.equal(api.workbench.state!.review!.files.length, 3);

      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, "src/auth/login.ts"), new TextEncoder().encode("export const login = () => 'edited in review';\n"));
      await eventually(() => loginText(lastReview()).includes("edited in review"), "the diff to follow the edit");

      assert.ok(api.workbench.receive({ type: "command", command: "acceptRun" }));
      await eventually(() => api.review.pending === undefined, "the run to be accepted");
      assert.equal(await gitIn("log", "-1", "--format=%(trailers:key=Spec-Task,valueonly)"), "T3\n\n");
      assert.match(await gitIn("show", "HEAD:src/auth/login.ts"), /edited in review/);
      await eventually(() => api.workbench.state?.review === undefined, "the workbench state to drop the review");
      assert.equal(api.workbench.receive({ type: "command", command: "acceptRun" }), undefined, "nothing left to accept");

      // Idle, the tab shows the working tree, read only.
      await eventually(() => sent.some((m) => m.type === "diff" && m.source === "working"), "the page to ask for the working tree");
    } finally {
      api.workbench.send = send;
    }
  });

  // workbench-ui/R5: the lens and the Specs view open the Trace tab on an item; a commit's diff comes back inline.
  test("traces a requirement in the workbench and shows a commit's diff", async () => {
    type Traced = { ref: string; kind?: string; commits?: { hash: string; subject: string }[] };
    type Workbench = { state?: { revision: number; trace?: Traced }; tab?: string; receive: (m: unknown) => unknown; send: (m: unknown) => void };
    const api = extension().exports as { workbench: Workbench; services: () => { root: string }[] };
    const root = api.services()[0]!.root;

    await vscode.commands.executeCommand("specflow.openWorkbench", { tab: "trace", ref: "accounts/R2", root });
    await eventually(() => api.workbench.tab === "trace" && api.workbench.state?.trace?.ref === "accounts/R2", "the Trace tab on accounts/R2");
    const traced = api.workbench.state!.trace!;
    assert.equal(traced.kind, "requirement");
    assert.ok(traced.commits!.some((c) => c.subject === "feat(accounts): Add lockout counter"), "the fixture's commit is traced");

    const sent: { type: string; source?: string; files?: { path: string }[] }[] = [];
    const send = api.workbench.send.bind(api.workbench);
    api.workbench.send = (message) => {
      sent.push(message as (typeof sent)[number]);
      send(message);
    };
    try {
      const hash = traced.commits!.at(-1)!.hash;
      assert.ok(api.workbench.receive({ type: "diff", source: "commit", root, commit: hash, revision: api.workbench.state!.revision }));
      await eventually(() => sent.some((m) => m.type === "diff" && m.source === "commit" && (m.files?.length ?? 0) > 0), "the commit's diff");
    } finally {
      api.workbench.send = send;
    }

    await vscode.commands.executeCommand("specflow.traceInWorkbench", { ref: { root, feature: "accounts", id: "T3" } });
    await eventually(() => api.workbench.state?.trace?.ref === "accounts/T3", "the Specs view's pick");
    assert.ok(api.workbench.receive({ type: "trace", root, ref: "accounts/R1" }));
    await eventually(() => api.workbench.state?.trace?.ref === "accounts/R1", "the page's pick");
  });

  // workbench-ui/R1: a spec change reaches the open page within 1 second; the page renders what it was sent.
  test("keeps the open workbench current and drops messages it cannot verify", async () => {
    const api = (extension().exports as { workbench: WorkbenchApi }).workbench;
    // A hidden page is torn down; showing it again makes it ask for the state.
    await vscode.commands.executeCommand("specflow.openWorkbench");
    await eventually(() => api.state !== undefined && api.rendered === api.state.revision, "the page to render the state");
    assert.match(api.state!.run?.target ?? "", /^accounts\/T\d+$/, "the latest run is in the state");

    const root = vscode.workspace.workspaceFolders![0]!.uri;
    const tasks = vscode.Uri.joinPath(root, ".specs/accounts/tasks.md");
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(tasks));
    const hasTask = () => api.state?.roots[0]?.features.find((f) => f.name === "accounts")?.tasks.some((t) => t.id === "T5") === true;
    assert.equal(hasTask(), false);
    const started = Date.now();
    await vscode.workspace.fs.writeFile(tasks, new TextEncoder().encode(`${text}\n## T5: Added for the workbench []\n`));
    await eventually(() => hasTask() && api.rendered === api.state!.revision, "the page to render the new task", 2000);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1000, `shown in ${elapsed} ms`);
    await vscode.workspace.fs.writeFile(tasks, new TextEncoder().encode(text));

    assert.equal(api.receive({ type: "eval", code: "1" }), undefined);
    assert.equal(api.receive({ type: "run", root: "/elsewhere", feature: "accounts", task: "T1" }), undefined);
    assert.equal(api.receive({ type: "openDiff", path: "../../etc/passwd" }), undefined);

    const workbenchTabs = () =>
      vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith("specflow.workbench"));
    api.panel!.dispose();
    await eventually(() => workbenchTabs().length === 0 && api.panel === undefined, "the workbench to close");
  });

  test("refuses to initialize over existing specs", async () => {
    await vscode.commands.executeCommand("specflow.init");
    const product = await vscode.workspace.findFiles(".specs/product.md");
    assert.equal(product.length, 1);
  });
} else if (process.env.SPECFLOW_SMOKE === "drift") {
  const root = () => vscode.workspace.workspaceFolders![0]!.uri;
  const requirements = () => vscode.Uri.joinPath(root(), ".specs/auth/requirements.md");
  const drift = () => vscode.languages.getDiagnostics(requirements()).filter((d) => String(d.code).startsWith("drift/"));
  const touchSpec = async () => {
    const tasks = vscode.Uri.joinPath(root(), ".specs/auth/tasks.md");
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(tasks));
    await vscode.workspace.fs.writeFile(tasks, new TextEncoder().encode(`${text}\n`));
  };

  // vscode-extension/R6: drift only runs on save when driftOnSave is set.
  test("does not check drift on save by default", async () => {
    await eventually(() => extension().isActive, "activation");
    await touchSpec();
    await new Promise((r) => setTimeout(r, 2000));
    assert.deepEqual(drift(), []);
  });

  test("checks drift on save with specflow.driftOnSave", async () => {
    const settings = vscode.workspace.getConfiguration("specflow");
    await settings.update("driftOnSave", true, vscode.ConfigurationTarget.Global);
    try {
      await touchSpec();
      await eventually(() => drift().length === 1, "drift diagnostic", 5000);
    } finally {
      await settings.update("driftOnSave", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  // vscode-extension/R6: findings on the requirement heading, naming file and commit.
  test("Check drift shows findings on the requirement heading with file and commit", async () => {
    const findings = (await vscode.commands.executeCommand("specflow.checkDrift")) as unknown[];
    assert.equal(findings.length, 1);
    const [diagnostic] = drift();
    assert.equal(diagnostic!.code, "drift/code-changed-since-spec");
    assert.equal(diagnostic!.severity, vscode.DiagnosticSeverity.Warning);
    assert.equal(diagnostic!.range.start.line, 2);
    assert.match(diagnostic!.message, /^src\/login\.ts changed in [0-9a-f]{7} "fix: reject empty passwords"/);
  });

  // workbench-ui/R2: Check drift on the Overview runs the real check; the counts reach the page.
  test("Overview's Check drift fills in the drift counts", async () => {
    type Api = {
      insights: { forget: (root: string) => void };
      services: () => { root: string }[];
      workbench: {
        state?: { revision: number; roots: { drift: { checked: boolean; findings?: { feature: string }[] } }[] };
        rendered?: number;
        receive: (message: unknown) => unknown;
      };
    };
    const api = extension().exports as Api;
    for (const service of api.services()) api.insights.forget(service.root);
    await vscode.commands.executeCommand("specflow.openWorkbench", { tab: "overview" });
    await eventually(() => api.workbench.rendered !== undefined && api.workbench.rendered === api.workbench.state?.revision, "the page to render");
    assert.equal(api.workbench.state!.roots[0]!.drift.checked, false);
    assert.deepEqual(api.workbench.receive({ type: "command", command: "checkDrift" }), { type: "command", command: "checkDrift" });
    await eventually(() => api.workbench.state!.roots[0]!.drift.checked && api.workbench.rendered === api.workbench.state!.revision, "drift results on the page");
    assert.deepEqual(api.workbench.state!.roots[0]!.drift.findings!.map((f) => f.feature), ["auth"]);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  // workbench-ui/R6: the Drift tab's check fills in findings; their commit diffs come back; only shown findings can be acknowledged.
  test("checks drift from the Drift tab and shows a finding's commit", async () => {
    type Finding = { feature: string; id?: string; commit?: string };
    type Workbench = {
      state?: { revision: number; driftChecking?: boolean; roots: { root: string; drift: { checked: boolean; findings?: Finding[] } }[] };
      tab?: string;
      receive: (m: unknown) => unknown;
      send: (m: unknown) => void;
    };
    const api = extension().exports as { workbench: Workbench };
    await vscode.commands.executeCommand("specflow.openWorkbench", { tab: "drift" });
    await eventually(() => api.workbench.tab === "drift", "the Drift tab");
    assert.ok(api.workbench.receive({ type: "command", command: "checkDrift" }));
    await eventually(() => api.workbench.state?.roots[0]?.drift.checked === true && !api.workbench.state.driftChecking, "the check to finish");
    const root = api.workbench.state!.roots[0]!;
    const [finding] = root.drift.findings!;
    assert.equal(finding?.feature, "auth");

    const sent: { type: string; source?: string; files?: unknown[] }[] = [];
    const send = api.workbench.send.bind(api.workbench);
    api.workbench.send = (message) => {
      sent.push(message as (typeof sent)[number]);
      send(message);
    };
    try {
      assert.ok(api.workbench.receive({ type: "diff", source: "commit", root: root.root, commit: finding!.commit, revision: api.workbench.state!.revision }));
      await eventually(() => sent.some((m) => m.type === "diff" && m.source === "commit" && (m.files?.length ?? 0) > 0), "the finding's commit diff");
    } finally {
      api.workbench.send = send;
    }
    assert.equal(api.workbench.receive({ type: "ack", root: root.root, feature: "auth", id: finding!.id, commit: "0000000" }), undefined);
    assert.equal(api.workbench.receive({ type: "ack", root: root.root, feature: "auth", id: "R9", commit: finding!.commit }), undefined);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  // workbench-ui/R7: Acknowledge drift writes drift-ack on the requirement and the finding goes away. Runs last: it clears the fixture's finding.
  test("acknowledges drift from the palette", async () => {
    const findings = (await vscode.commands.executeCommand("specflow.checkDrift")) as { evidence?: { commit?: string } }[];
    const commit = findings[0]!.evidence!.commit!;
    const result = (await vscode.commands.executeCommand("specflow.ackDrift", "auth/R1", commit, { confirm: false })) as { ok: boolean; value: { commit: string } };
    assert.equal(result.ok, true);
    assert.match(result.value.commit, /^[0-9a-f]{40}$/);
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(requirements()));
    assert.match(text, new RegExp(`^## R1: .*\\ndrift-ack: ${result.value.commit}$`, "m"));
    await eventually(() => drift().length === 0, "the drift diagnostic to go away");
    const unknown = (await vscode.commands.executeCommand("specflow.ackDrift", "auth/R9", "HEAD", { confirm: false })) as { ok: boolean };
    assert.equal(unknown.ok, false);
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

  // workbench-ui/R1, R2, R4: a workspace that was just initialized opens the workbench on its example feature.
  test("opens the workbench on a freshly initialized workspace", async () => {
    type Workbench = {
      state?: { revision: number; roots: { features: { name: string; tasks: { id: string }[] }[] }[]; review?: unknown };
      rendered?: number;
      receive: (m: unknown) => unknown;
      send: (m: unknown) => void;
    };
    const api = (extension().exports as { workbench: Workbench }).workbench;
    await vscode.commands.executeCommand("specflow.openWorkbench", { tab: "review" });
    await eventually(() => api.state?.roots[0]?.features.some((f) => f.name === "example") === true && api.rendered === api.state.revision, "the example feature on the page");
    assert.equal(api.state!.review, undefined);
    // This workspace is not a git repository: the Review tab's working tree diff says so plainly.
    const sent: { type: string; source?: string; files?: unknown[]; error?: string }[] = [];
    const send = api.send.bind(api);
    api.send = (message) => {
      sent.push(message as (typeof sent)[number]);
      send(message);
    };
    try {
      await eventually(() => sent.some((m) => m.type === "diff" && m.source === "working"), "the page to ask for the working tree", 3000).catch(async () => {
        // The page may have asked before the spy was installed; ask again for this revision.
        api.receive({ type: "diff", source: "working", root: vscode.workspace.workspaceFolders![0]!.uri.fsPath.replaceAll("\\", "/"), revision: api.state!.revision });
        await eventually(() => sent.some((m) => m.type === "diff" && m.source === "working"), "the working tree diff");
      });
      const answer = sent.find((m) => m.type === "diff" && m.source === "working")!;
      assert.match(answer.error ?? "", /is not in a git working tree$/);
    } finally {
      api.send = send;
    }
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
      console.log(String((error as Error).stack).split("\n").slice(0, 8).join("\n"));
      throw error;
    }
  }
}
