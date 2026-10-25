import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTasks } from "./tasks.js";

const options = { file: "/repo/.specs/auth/tasks.md", feature: "auth", prefix: "T" };

const sample = `# auth: tasks

## T1: Set up CI []
status: done
files: package.json, .github/workflows/ci.yml

CI runs on every push.

## T2: Add lockout counter [R3, R4]
status: doing
files: src/auth/login.ts, src/auth/**
depends: T1, task-run/T7
owner: someone

- Counter resets after 15 minutes.

## T3: No bracket list

## T4 [R1]
status: todo

## T5: Spaced refs [ R1 ,R2,, ]
status: finished
`;

function parse(markdown: string = sample, opts = options) {
  return parseTasks(markdown, opts);
}

describe("parseTasks", () => {
  // core-spec-model/R2
  it("turns each valid heading into a task, in order", () => {
    expect(parse().tasks.map((t) => [t.id, t.title])).toEqual([
      ["T1", "Set up CI"],
      ["T2", "Add lockout counter"],
      ["T3", "No bracket list"],
      ["T5", "Spaced refs"],
    ]);
  });

  it("reads requirement references from the heading", () => {
    const [, t2, , t5] = parse().tasks;
    expect(t2).toMatchObject({ feature: "auth", id: "T2", title: "Add lockout counter", reqs: ["R3", "R4"] });
    expect(t5!.reqs).toEqual(["R1", "R2"]);
  });

  it("treats an empty or missing reference list as no references", () => {
    const [t1, , t3] = parse().tasks;
    expect(t1!.reqs).toEqual([]);
    expect(t3!.reqs).toEqual([]);
  });

  it("maps status, files and depends", () => {
    const [t1, t2, t3] = parse().tasks;
    expect(t1).toMatchObject({ status: "done", files: ["package.json", ".github/workflows/ci.yml"], depends: [] });
    expect(t2).toMatchObject({
      status: "doing",
      files: ["src/auth/login.ts", "src/auth/**"],
      depends: ["T1", "task-run/T7"],
    });
    expect(t3).toMatchObject({ status: "todo", files: [], depends: [] });
  });

  it("keeps the body without the heading and metadata lines", () => {
    const [t1, t2, t3] = parse().tasks;
    expect(t1!.body).toBe("CI runs on every push.");
    expect(t2!.body).toBe("- Counter resets after 15 minutes.");
    expect(t3!.body).toBe("");
  });

  it("reports a malformed task heading and skips it", () => {
    const { tasks, findings } = parse();
    expect(tasks.map((t) => t.id)).not.toContain("T4");
    expect(findings).toEqual([
      expect.objectContaining({
        rule: "malformed-heading",
        severity: "error",
        location: { file: options.file, startLine: 19, endLine: 19 },
        feature: "auth",
      }),
    ]);
  });

  // core-spec-model/R4
  it("records the file and 1-based line range of each task", () => {
    expect(parse().tasks.map((t) => t.location)).toEqual([
      { file: options.file, startLine: 3, endLine: 7 },
      { file: options.file, startLine: 9, endLine: 15 },
      { file: options.file, startLine: 17, endLine: 17 },
      { file: options.file, startLine: 22, endLine: 23 },
    ]);
  });

  // core-spec-model/R8
  it("keeps unknown metadata and unrecognized status values in extra", () => {
    const [, t2, , t5] = parse().tasks;
    expect(t2!.extra).toEqual({ owner: "someone" });
    expect(t5).toMatchObject({ status: "todo", extra: { status: "finished" } });
  });

  it("parses the clean fixture", () => {
    const path = fileURLToPath(new URL("../../../../fixtures/specs/clean/.specs/accounts/tasks.md", import.meta.url));
    const { tasks, findings } = parseTasks(readFileSync(path, "utf8"), { ...options, file: path });
    expect(findings).toEqual([]);
    expect(tasks.map((t) => [t.id, t.reqs, t.status, t.depends])).toEqual([
      ["T1", [], "done", []],
      ["T2", ["R1"], "done", ["T1"]],
      ["T3", ["R2"], "todo", ["T2"]],
    ]);
    expect(tasks[2]!.files).toEqual(["src/auth/login.ts", "src/auth/lockout.ts"]);
  });
});
