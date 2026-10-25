import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultConfig, loadConfig, parseConfig } from "./config.js";
import { MemoryFileSystem } from "./fs.js";
import { NodeFileSystem } from "./node/fs.js";

function expectOk(result: ReturnType<typeof parseConfig>) {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function expectError(text: string) {
  const result = parseConfig(text);
  if (result.ok) throw new Error("expected an error");
  return result.error;
}

describe("loadConfig", () => {
  // core-spec-model/R6: no config.yml means defaults, no error.
  it("returns the defaults when config.yml is missing", async () => {
    const result = await loadConfig(new MemoryFileSystem({ "/repo/.specs/a/tasks.md": "" }), "/repo");
    expect(result).toEqual({ ok: true, value: defaultConfig });
  });

  it("does not hand out the defaults object itself", async () => {
    const result = await loadConfig(new MemoryFileSystem(), "/repo");
    if (!result.ok) throw new Error(result.error.message);
    result.value.drift.ignore.push("changed");
    expect(defaultConfig.drift.ignore).not.toContain("changed");
  });

  it("reads <root>/.specs/config.yml", async () => {
    const fs = new MemoryFileSystem({ "/repo/.specs/config.yml": "commit:\n  mode: auto\n" });
    const result = await loadConfig(fs, "/repo");
    expect(result.ok && result.value.commit.mode).toBe("auto");
  });

  it("loads this repo's own config", async () => {
    const root = join(fileURLToPath(import.meta.url), "../../../..");
    const result = await loadConfig(new NodeFileSystem(), root);
    expect(result).toEqual({
      ok: true,
      value: { ...defaultConfig, harness: { default: "claude-code", adapters: { "claude-code": { extraArgs: [] } } } },
    });
  });
});

describe("parseConfig", () => {
  it("treats an empty file as all defaults", () => {
    expect(expectOk(parseConfig(""))).toEqual(defaultConfig);
  });

  it("merges a partial file over the defaults", () => {
    const config = expectOk(parseConfig("commit:\n  mode: auto\ndrift:\n  ignore: []\n"));
    expect(config.commit).toEqual({ mode: "auto", trailers: true });
    expect(config.drift).toEqual({ llm: false, llmBytes: 20_000, ignore: [] });
    expect(config.ids).toEqual(defaultConfig.ids);
  });

  it("collects adapter settings under harness.adapters", () => {
    const config = expectOk(
      parseConfig("harness:\n  default: other\n  claude-code:\n    extraArgs: [--verbose]\n  other: {}\n"),
    );
    expect(config.harness).toEqual({
      default: "other",
      adapters: { "claude-code": { extraArgs: ["--verbose"] }, other: { extraArgs: [] } },
    });
  });

  // core-spec-model/R6: an invalid value fails with the key and the expected type.
  it.each([
    ["commit:\n  mode: yolo\n", "commit.mode", 'expected one of "staged"|"auto"'],
    ["commit:\n  trailers: yes please\n", "commit.trailers", "expected boolean"],
    ["drift:\n  ignore: '*.md'\n", "drift.ignore", "expected array"],
    ["harness:\n  claude-code:\n    extraArgs: --verbose\n", "harness.claude-code.extraArgs", "expected array"],
    ["ids:\n  task: T-\n", "ids.task", "expected letters only"],
    ["version: 2\n", "version", "expected 1"],
    ["- just\n- a list\n", "(root)", "expected object"],
  ])("rejects %j naming %s", (text, key, expected) => {
    const error = expectError(text);
    expect(error.issues).toEqual([{ key, message: expect.stringContaining(expected) }]);
    expect(error.message).toContain(`${key}: `);
    expect(error.message).toContain(expected);
  });

  it("reports every invalid key at once", () => {
    const error = expectError("commit:\n  mode: yolo\ndrift:\n  llm: maybe\n");
    expect(error.issues.map((issue) => issue.key)).toEqual(["commit.mode", "drift.llm"]);
  });

  it("reports YAML syntax errors with the file name", () => {
    const result = parseConfig("commit: [unclosed\n", "/repo/.specs/config.yml");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toMatch(/^\/repo\/\.specs\/config\.yml: /);
  });
});
