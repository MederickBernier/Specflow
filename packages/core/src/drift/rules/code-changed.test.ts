import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSpecTree } from "../../load.js";
import type { Finding } from "../../model.js";
import { NodeFileSystem } from "../../node/fs.js";
import { NodeGit } from "../../node/git.js";
import { toPosixPath } from "../../paths.js";
import { buildDriftContext } from "../context.js";
import { codeChangedSinceSpec } from "./code-changed.js";

const fixtures = toPosixPath(fileURLToPath(new URL("../../../../../fixtures", import.meta.url)));
const scenarios = ["clean", "code-changed-since-spec", "spec-changed-since-code", "unimplemented", "out-of-scope"];

async function run(scenario: string): Promise<Finding[]> {
  const root = `${fixtures}/repos/drift-${scenario}`;
  const tree = await loadSpecTree(new NodeFileSystem(), root);
  if (!tree.ok) throw new Error(tree.error.message);
  const context = await buildDriftContext(new NodeGit({ cwd: root }), tree.value);
  if (!context.ok) throw new Error(context.error.message);
  return codeChangedSinceSpec.check(context.value);
}

/** The shape of fixtures/drift/<name>.expected.json entries. */
const asExpected = (f: Finding) => ({
  rule: f.rule,
  feature: f.feature,
  id: f.id,
  ...(f.evidence?.file && { file: f.evidence.file }),
  ...(f.evidence?.subject && { commit: f.evidence.subject }),
});

function expected(scenario: string) {
  const all = JSON.parse(readFileSync(`${fixtures}/drift/${scenario}.expected.json`, "utf8")) as { rule: string }[];
  return all.filter((f) => f.rule === codeChangedSinceSpec.id);
}

describe("drift/code-changed-since-spec", () => {
  // drift-check/R1
  it.each(scenarios)("matches fixtures/drift/%s.expected.json", async (scenario) => {
    expect((await run(scenario)).map(asExpected)).toEqual(expected(scenario));
  });

  it("names the file and the commit, on the requirement's heading", async () => {
    const [finding] = await run("code-changed-since-spec");
    expect(finding).toMatchObject({
      severity: "warning",
      message: expect.stringMatching(/^src\/login\.ts changed in [0-9a-f]{7} "fix: reject empty passwords" after R1 was last implemented/),
      location: { file: `${fixtures}/repos/drift-code-changed-since-spec/.specs/auth/requirements.md`, startLine: 3, endLine: 3 },
      evidence: { file: "src/login.ts", commit: expect.stringMatching(/^[0-9a-f]{40}$/) },
    });
  });

  it("still reports on the acked fixture; suppression is a separate step", async () => {
    expect((await run("acked")).map(asExpected)).toEqual(expected("code-changed-since-spec"));
  });

  // drift-check/R7
  it("returns identical findings on every run", async () => {
    expect(await run("code-changed-since-spec")).toEqual(await run("code-changed-since-spec"));
  });
});
