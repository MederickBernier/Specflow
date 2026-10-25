import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSpecTree } from "../load.js";
import type { SpecTree } from "../model.js";
import { NodeFileSystem } from "../node/fs.js";
import { NodeGit } from "../node/git.js";
import { toPosixPath } from "../paths.js";
import { ok } from "../result.js";
import type { HarnessAdapter } from "../run/adapter.js";
import type { RunEvent } from "../run/events.js";
import { ReplayAdapter } from "../run/replay-adapter.js";
import { checkDrift } from "./check.js";
import { buildDriftContext } from "./context.js";
import { llmPrompt, parseVerdict } from "./llm.js";

const fs = new NodeFileSystem();
const root = `${toPosixPath(fileURLToPath(new URL("../../../../fixtures/repos", import.meta.url)))}/drift-code-changed-since-spec`;
const started: RunEvent = { kind: "started", runId: "r", harness: "replay", at: "2026-01-01T00:00:00Z" };
const answer = (text: string): RunEvent[] => [started, { kind: "message", role: "assistant", text }, { kind: "finished", ok: true, summary: text }];

async function tree(llmBytes?: number): Promise<SpecTree> {
  const loaded = await loadSpecTree(fs, root);
  if (!loaded.ok) throw new Error(loaded.error.message);
  return llmBytes === undefined ? loaded.value : { ...loaded.value, config: { ...loaded.value.config, drift: { ...loaded.value.config.drift, llmBytes } } };
}

async function verdictWith(adapter: HarnessAdapter) {
  const result = await checkDrift(new NodeGit({ cwd: root }), await tree(), { llm: { adapter, fs } });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.value).toHaveLength(1);
  return result.value[0]!.verdict;
}

describe("LLM pass", () => {
  // drift-check/R6: a valid answer becomes the verdict.
  it("attaches a valid answer as the verdict", async () => {
    const adapter = new ReplayAdapter({ events: answer('{"verdict": "holds", "reason": "Empty passwords are rejected, sign in still works."}') });
    expect(await verdictWith(adapter)).toEqual({ verdict: "holds", reason: "Empty passwords are rejected, sign in still works." });
    expect(adapter.inputs).toHaveLength(1);
  });

  it("reads an answer inside a code fence", async () => {
    const adapter = new ReplayAdapter({ events: answer('Here you go:\n```json\n{"verdict":"broken","reason":"Sign in now needs an argument."}\n```') });
    expect(await verdictWith(adapter)).toEqual({ verdict: "broken", reason: "Sign in now needs an argument." });
  });

  // drift-check/R6: malformed answers are unsure, never a failure.
  it("turns a malformed answer into unsure with the raw text", async () => {
    expect(await verdictWith(new ReplayAdapter({ events: answer("I think it is fine?") }))).toEqual({
      verdict: "unsure",
      reason: "Unreadable answer: I think it is fine?",
    });
  });

  // drift-check/R6: a harness that edits files is aborted.
  it("aborts a harness that edits a file and marks the finding unsure", async () => {
    const adapter = new ReplayAdapter({
      events: [
        started,
        { kind: "file-changed", path: "src/login.ts", change: "modified" },
        { kind: "message", role: "assistant", text: "should never be read" },
        { kind: "finished", ok: true, summary: '{"verdict":"holds","reason":"x"}' },
      ],
    });
    expect(await verdictWith(adapter)).toEqual({
      verdict: "unsure",
      reason: "The harness changed src/login.ts during a read-only review, so the run was aborted",
    });
  });

  it("marks a failing harness unsure", async () => {
    const throws: HarnessAdapter = {
      name: "replay",
      check: async () => ok({ version: "1", warnings: [] }),
      run: async function* () {
        yield started;
        throw new Error("rate limited");
      },
    };
    expect(await verdictWith(throws)).toEqual({ verdict: "unsure", reason: "The harness failed: rate limited" });
  });

  // drift-check/R6: no LLM call without the option.
  it("calls no harness without the llm option", async () => {
    const adapter = new ReplayAdapter({ events: answer('{"verdict":"holds","reason":"x"}') });
    const result = await checkDrift(new NodeGit({ cwd: root }), await tree());
    expect(result.ok && result.value[0]?.verdict).toBeUndefined();
    expect(adapter.inputs).toEqual([]);
  });
});

describe("llmPrompt", () => {
  async function prompt(llmBytes?: number) {
    const t = await tree(llmBytes);
    const context = await buildDriftContext(new NodeGit({ cwd: root }), t);
    if (!context.ok) throw new Error(context.error.message);
    const result = await checkDrift(new NodeGit({ cwd: root }), t);
    if (!result.ok) throw new Error(result.error.message);
    return llmPrompt(fs, context.value, result.value[0]!);
  }

  it("includes the requirement, its criteria, the finding and the touched files, read-only", async () => {
    const text = (await prompt())!;
    expect(text).toContain('<requirement id="auth/R1">\n## R1: Sign in');
    expect(text).toContain("<criteria>\n- Given a registered user\n- When they sign in with the right password\n- Then they are signed in\n</criteria>");
    expect(text).toContain('<file path="src/login.ts">\nexport const login = (password: string) => password.length > 0;\n</file>');
    expect(text).toContain("do not edit, create or delete any file");
    expect(text).toContain('{"verdict": "holds" | "broken" | "unsure"');
  });

  it("truncates file content to drift.llmBytes", async () => {
    const text = (await prompt(12))!;
    expect(text).toContain('<file path="src/login.ts">\nexport const\n[truncated]\n</file>');
  });
});

describe("parseVerdict", () => {
  it.each([
    ['{"verdict":"maybe","reason":"x"}', "unsure"],
    ["", "unsure"],
    ['{"verdict":"broken"}', "broken"],
  ])("reads %j as %s", (text, verdict) => {
    expect(parseVerdict(text).verdict).toBe(verdict);
  });
});
