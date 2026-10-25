import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config.js";
import type { Git } from "../git.js";
import { loadSpecTree } from "../load.js";
import type { SpecTree, Task } from "../model.js";
import { NodeFileSystem } from "../node/fs.js";
import { NodeGit } from "../node/git.js";
import { toPosixPath } from "../paths.js";
import { readHistory, type TraceCommit } from "../trace/commits.js";
import { buildDriftIndex } from "./index.js";

const repos = toPosixPath(fileURLToPath(new URL("../../../../fixtures/repos/", import.meta.url)));

async function fixture(name: string) {
  const root = `${repos}/drift-${name}`;
  const tree = await loadSpecTree(new NodeFileSystem(), root);
  if (!tree.ok) throw new Error(tree.error.message);
  let calls = 0;
  const real = new NodeGit({ cwd: root });
  const counting: Git = { run: (args, options) => (calls++, real.run(args, options)), lines: (args, options) => real.lines(args, options) };
  const history = await readHistory(counting, root);
  if (!history.ok) throw new Error(history.error.message);
  return { index: buildDriftIndex(tree.value, history.value), calls };
}

const subjects = (commits: TraceCommit[] | undefined) => commits?.map((c) => c.subject);

describe("buildDriftIndex on drift fixtures", () => {
  // drift-check/R1: the trace index comes from a single git log.
  it("indexes trace commits and touched files per requirement from one git log", async () => {
    const { index, calls } = await fixture("clean");
    expect(calls).toBe(1);
    expect(index.commits).toHaveLength(5);
    expect(index.requirements.get("auth/R1")).toEqual({
      traceCommits: [expect.objectContaining({ subject: "feat(auth): Sign in" })],
      touched: ["src/login.ts"],
    });
    expect(index.requirements.get("auth/R2")?.touched).toEqual(["src/logout.ts"]);
    expect(index.position.get(index.commits[0]!.hash)).toBe(0);
  });

  // drift-check/R4: ignored files and spec files have no history.
  it("leaves drift.ignore matches and spec files out of the file history", async () => {
    const { index } = await fixture("clean");
    expect([...index.fileHistory.keys()].sort()).toEqual(["src/login.ts", "src/logout.ts", "test/login.test.ts"]);
  });

  it("orders file history newest first", async () => {
    const { index } = await fixture("code-changed-since-spec");
    expect(subjects(index.fileHistory.get("src/login.ts"))).toEqual(["fix: reject empty passwords", "feat(auth): Sign in"]);
  });

  it("keeps files outside the task's files out of the touched set", async () => {
    const { index } = await fixture("out-of-scope");
    expect(index.requirements.get("auth/R1")?.touched).toEqual(["src/login.ts"]);
    expect(subjects(index.fileHistory.get("src/session.ts"))).toEqual(["refactor: session store", "feat(auth): Sign in"]);
  });

  it("has empty entries for requirements nothing references", async () => {
    const { index } = await fixture("unimplemented");
    expect(index.requirements.get("auth/R3")).toEqual({ traceCommits: [], touched: [] });
  });
});

describe("buildDriftIndex touched sets", () => {
  const task = (files: string[]): Task => ({
    feature: "a",
    id: "T1",
    title: "t",
    reqs: ["R1"],
    status: "done",
    files,
    depends: [],
    body: "",
    extra: {},
    location: { file: "/r/.specs/a/tasks.md", startLine: 1, endLine: 1 },
  });
  const tree = (files: string[], ignore = defaultConfig.drift.ignore): SpecTree => ({
    root: "/r",
    config: { ...defaultConfig, drift: { llm: false, ignore } },
    features: [
      {
        name: "a",
        dir: "/r/.specs/a",
        requirements: [
          {
            feature: "a",
            id: "R1",
            title: "r",
            status: "approved",
            body: "",
            criteria: [],
            extra: {},
            location: { file: "/r/.specs/a/requirements.md", startLine: 1, endLine: 1 },
          },
        ],
        tasks: [task(files)],
        findings: [],
      },
    ],
  });
  const commit = (hash: string, files: TraceCommit["files"], reqs: string[] = []): TraceCommit => ({
    hash,
    date: "2026-01-01T00:00:00Z",
    subject: hash,
    files,
    features: [],
    tasks: [],
    reqs,
  });

  // Newest first, as git log prints them.
  const history = [
    commit("c4", [{ status: "R100", from: "src/b.ts", path: "src/renamed.ts" }]),
    commit("c3", [{ status: "D", path: "src/a.ts" }]),
    commit("c2", [{ status: "M", path: "src/c.ts" }]),
    commit("c1", [
      { status: "A", path: "src/a.ts" },
      { status: "A", path: "src/b.ts" },
      { status: "A", path: "docs/notes.md" },
      { status: "A", path: ".specs/a/tasks.md" },
      { status: "A", path: "gen/out.js" },
    ], ["a/R1"]),
  ];

  it("drops files deleted later and follows renames", () => {
    expect(buildDriftIndex(tree([]), history).requirements.get("a/R1")?.touched).toEqual(["gen/out.js", "src/renamed.ts"]);
  });

  it("restricts to the task's files patterns when it has them", () => {
    expect(buildDriftIndex(tree(["src/**"]), history).requirements.get("a/R1")?.touched).toEqual(["src/renamed.ts"]);
  });

  // drift-check/R4: custom ignore globs.
  it("applies custom drift.ignore globs to touched sets and file history", () => {
    const index = buildDriftIndex(tree([], ["gen/**"]), history);
    expect(index.requirements.get("a/R1")?.touched).toEqual(["docs/notes.md", "src/renamed.ts"]);
    expect(index.fileHistory.has("gen/out.js")).toBe(false);
    expect(index.fileHistory.has("docs/notes.md")).toBe(true);
  });
});
