import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSpecTree } from "../../load.js";
import type { Finding } from "../../model.js";
import { NodeFileSystem } from "../../node/fs.js";
import { NodeGit } from "../../node/git.js";
import { toPosixPath } from "../../paths.js";
import { buildDriftContext, type DriftRule } from "../context.js";
import { specChangedSinceCode } from "./spec-changed.js";
import { unimplemented } from "./unimplemented.js";

const fixtures = toPosixPath(fileURLToPath(new URL("../../../../../fixtures", import.meta.url)));
const scenarios = ["clean", "code-changed-since-spec", "spec-changed-since-code", "unimplemented", "acked", "out-of-scope"];

async function run(rule: DriftRule, scenario: string): Promise<Finding[]> {
  const root = `${fixtures}/repos/drift-${scenario}`;
  const tree = await loadSpecTree(new NodeFileSystem(), root);
  if (!tree.ok) throw new Error(tree.error.message);
  const context = await buildDriftContext(new NodeGit({ cwd: root }), tree.value);
  if (!context.ok) throw new Error(context.error.message);
  return rule.check(context.value);
}

const asExpected = (f: Finding) => ({
  rule: f.rule,
  feature: f.feature,
  id: f.id,
  ...(f.evidence?.file && { file: f.evidence.file }),
  ...(f.evidence?.subject && { commit: f.evidence.subject }),
});

const expected = (rule: DriftRule, scenario: string) =>
  (JSON.parse(readFileSync(`${fixtures}/drift/${scenario}.expected.json`, "utf8")) as { rule: string }[]).filter(
    (f) => f.rule === rule.id,
  );

describe.each([
  ["drift/spec-changed-since-code", specChangedSinceCode],
  ["drift/unimplemented", unimplemented],
] as const)("%s", (_name, rule) => {
  // drift-check/R2, R3
  it.each(scenarios)("matches fixtures/drift/%s.expected.json", async (scenario) => {
    expect((await run(rule, scenario)).map(asExpected)).toEqual(expected(rule, scenario));
  });

  // drift-check/R7
  it("returns identical findings on every run", async () => {
    const scenario = rule.id.replace("drift/", "");
    expect(await run(rule, scenario)).toEqual(await run(rule, scenario));
  });
});

describe("rule details", () => {
  it("spec-changed-since-code names the spec commit", async () => {
    const [finding] = await run(specChangedSinceCode, "spec-changed-since-code");
    expect(finding).toMatchObject({
      severity: "warning",
      location: { startLine: 11, endLine: 11 },
      evidence: { commit: expect.stringMatching(/^[0-9a-f]{40}$/), subject: "docs(specs): sign out ends every session" },
    });
  });

  it("unimplemented names the done tasks", async () => {
    const [finding] = await run(unimplemented, "unimplemented");
    expect(finding?.message).toBe("R3 has all its tasks done (auth/T3) but no commit references it; trailers were probably missed");
  });
});
