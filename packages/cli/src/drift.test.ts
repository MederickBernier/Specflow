import { fileURLToPath } from "node:url";
import { AdapterRegistry, FakeClock, ReplayAdapter, type RunEvent, toPosixPath } from "@specflow/core";
import { NodeFileSystem, NodeGit } from "@specflow/core/node";
import { describe, expect, it } from "vitest";
import { run } from "./program.js";

const repos = toPosixPath(fileURLToPath(new URL("../../../fixtures/repos", import.meta.url)));

const reviewer = (text: string) => {
  const events: RunEvent[] = [
    { kind: "started", runId: "r", harness: "claude-code", at: "2026-01-01T00:00:00Z" },
    { kind: "finished", ok: true, summary: text },
  ];
  return new ReplayAdapter({ name: "claude-code", events });
};
let registry = new AdapterRegistry();

async function specflow(fixture: string, ...argv: string[]) {
  const root = `${repos}/drift-${fixture}`;
  let stdout = "";
  let stderr = "";
  const code = await run(argv, {
    cwd: `${root}/src`,
    fs: new NodeFileSystem(),
    git: new NodeGit({ cwd: root }),
    registry,
    clock: new FakeClock(),
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    onInterrupt: () => () => {},
  });
  // Hashes depend only on fixture content, but keep snapshots readable if the fixtures change.
  const clean = (text: string) => text.replaceAll(root, "<root>").replace(/\b[0-9a-f]{40}\b/g, "<hash>").replace(/\b[0-9a-f]{7}\b/g, "<short>");
  return { code, stdout: clean(stdout), stderr: clean(stderr) };
}

describe("specflow drift", () => {
  it("reports no drift on the clean fixture", async () => {
    expect(await specflow("clean", "drift")).toEqual({ code: 0, stdout: "No drift found.\n", stderr: "" });
  });

  // drift-check/R7: text and JSON snapshots.
  it.each(["code-changed-since-spec", "spec-changed-since-code", "unimplemented"])("reports the %s fixture", async (fixture) => {
    const text = await specflow(fixture, "drift");
    const json = await specflow(fixture, "drift", "--json");
    expect(text.code).toBe(0);
    expect(text.stdout).toMatchSnapshot("text");
    expect(json.stdout).toMatchSnapshot("json");
    expect(JSON.parse(json.stdout).schema).toBe("specflow.drift/v1");
  });

  // drift-check/R7: same repo state, identical output.
  it("prints identical output on every run", async () => {
    for (const args of [["drift"], ["drift", "--json"]]) {
      expect(await specflow("code-changed-since-spec", ...args)).toEqual(await specflow("code-changed-since-spec", ...args));
    }
  });

  it("exits 1 with --fail-on warning only when there are findings", async () => {
    expect((await specflow("code-changed-since-spec", "drift", "--fail-on", "warning")).code).toBe(1);
    expect((await specflow("code-changed-since-spec", "drift", "--fail-on", "error")).code).toBe(0);
    expect((await specflow("clean", "drift", "--fail-on", "warning")).code).toBe(0);
  });

  it("rejects an unknown --fail-on value", async () => {
    const result = await specflow("clean", "drift", "--fail-on", "sometimes");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Allowed choices are warning, error");
  });

  it("limits findings to a target", async () => {
    expect((await specflow("code-changed-since-spec", "drift", "auth/R2")).stdout).toBe("No drift found.\n");
    expect((await specflow("code-changed-since-spec", "drift", "auth")).stdout).toContain("drift/code-changed-since-spec");
  });

  // drift-check/R6 from the CLI.
  it("adds the harness verdict with --llm", async () => {
    registry = new AdapterRegistry([reviewer('{"verdict":"holds","reason":"Empty passwords are rejected."}')]);
    try {
      const result = await specflow("code-changed-since-spec", "drift", "--llm");
      expect(result.stdout).toContain("\n  verdict: holds: Empty passwords are rejected.\n");
      const json = JSON.parse((await specflow("code-changed-since-spec", "drift", "--llm", "--json")).stdout);
      expect(json.findings[0].verdict).toEqual({ verdict: "holds", reason: "Empty passwords are rejected." });
    } finally {
      registry = new AdapterRegistry();
    }
  });

  it("fails clearly when --llm has no usable harness", async () => {
    const result = await specflow("code-changed-since-spec", "drift", "--llm");
    expect(result).toEqual({
      code: 2,
      stdout: "",
      stderr: 'specflow: Unknown harness "claude-code". Registered: none\n',
    });
  });
});
