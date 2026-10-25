import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../fs.js";
import { loadSpecTree } from "../load.js";
import type { SpecTree, Task } from "../model.js";
import { NodeFileSystem } from "../node/fs.js";
import { NodeGit } from "../node/git.js";
import { toPosixPath } from "../paths.js";
import { recordRun } from "./recorder.js";
import { restoreTaskStatus, setTaskStatus, tasksFile } from "./status.js";

const file = "/repo/.specs/auth/tasks.md";

async function setup(tasks: string) {
  const fs = new MemoryFileSystem({ "/repo/.git/HEAD": "", [file]: tasks });
  const tree = await loadSpecTree(fs, "/repo");
  if (!tree.ok) throw new Error(tree.error.message);
  return { fs, tree: tree.value };
}

/** Lines that differ between two versions of a file, as [line number, before, after]. */
function changedLines(before: string, after: string): [number, string | undefined, string | undefined][] {
  const a = before.split("\n");
  const b = after.split("\n");
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [i + 1, a[i], b[i]] as [number, string | undefined, string | undefined]).filter(
    ([, x, y]) => x !== y,
  );
}

const tasks = `# auth: tasks

## T1: Set up []
status: done

## T2: Add lockout counter [R3]
files: src/login.ts
status:   todo  
depends: T1

Body mentions status: todo, which must not change.

## T3: No status yet [R3]
files: src/other.ts

Body.
`;

async function transition(text: string, task: string, status: Task["status"]) {
  const { fs, tree } = await setup(text);
  const snapshot = await setTaskStatus(fs, tree, { feature: "auth", task }, status);
  if (!snapshot.ok) throw new Error(snapshot.error.message);
  return { fs, tree, snapshot: snapshot.value, after: await fs.readFile(file) };
}

describe("setTaskStatus", () => {
  // task-run/R7: a run starts -> doing, only the status line changes.
  it("changes only the status line, keeping its spacing", async () => {
    const { after, snapshot } = await transition(tasks, "T2", "doing");
    expect(changedLines(tasks, after)).toEqual([[8, "status:   todo  ", "status:   doing  "]]);
    expect(snapshot).toEqual({ feature: "auth", task: "T2", previous: "todo", line: "status:   todo  " });
  });

  // task-run/R7: every transition touches only the status line.
  it.each([
    ["todo", "doing"],
    ["doing", "done"],
    ["doing", "todo"],
    ["todo", "blocked"],
  ] as const)("%s -> %s changes only the status line", async (from, to) => {
    const text = `## T1: Task []\nstatus: ${from}\nfiles: a.ts\n\nBody.\n`;
    const { after } = await transition(text, "T1", to);
    expect(changedLines(text, after)).toEqual([[2, `status: ${from}`, `status: ${to}`]]);
  });

  it("inserts the line right after the heading when it is missing", async () => {
    const { after, snapshot } = await transition(tasks, "T3", "doing");
    expect(after).toBe(tasks.replace("## T3: No status yet [R3]\n", "## T3: No status yet [R3]\nstatus: doing\n"));
    expect(snapshot).toMatchObject({ previous: "todo", line: null });
  });

  it("keeps CRLF line endings", async () => {
    const text = "## T1: Task []\r\nstatus: todo\r\nfiles: a.ts\r\n\r\n## T2: Other []\r\n";
    const { after } = await transition(text, "T1", "doing");
    expect(after).toBe("## T1: Task []\r\nstatus: doing\r\nfiles: a.ts\r\n\r\n## T2: Other []\r\n");
    const inserted = await transition(text, "T2", "doing");
    expect(inserted.after).toBe(`${text}status: doing\r\n`);
  });

  it("handles setext headings and a bare status key", async () => {
    const text = "T1: Setext []\n---\nstatus:\n";
    const { after } = await transition(text, "T1", "doing");
    expect(after).toBe("T1: Setext []\n---\nstatus: doing\n");
  });

  it("reads the file again, keeping edits made after the tree was loaded", async () => {
    const { fs, tree } = await setup(tasks);
    await fs.writeFile(file, tasks.replace("Body.\n", "Body edited by the harness.\n"));
    await setTaskStatus(fs, tree, { feature: "auth", task: "T2" }, "done");
    const after = await fs.readFile(file);
    expect(after).toContain("Body edited by the harness.");
    expect(after).toContain("status:   done  ");
  });

  it("fails on an unknown task or feature", async () => {
    const { fs, tree } = await setup(tasks);
    expect(await setTaskStatus(fs, tree, { feature: "auth", task: "T9" }, "doing")).toEqual({
      ok: false,
      error: { kind: "unknown-task", message: "No task auth/T9" },
    });
    expect((await setTaskStatus(fs, tree, { feature: "nope", task: "T1" }, "doing")).ok).toBe(false);
  });
});

describe("restoreTaskStatus", () => {
  // task-run/R7: a failed run returns to the previous status, file identical.
  it.each(["T1", "T2", "T3"])("restores %s byte for byte", async (task) => {
    const { fs, tree, snapshot } = await transition(tasks, task, "doing");
    expect(await restoreTaskStatus(fs, tree, snapshot)).toEqual({ ok: true, value: undefined });
    expect(await fs.readFile(file)).toBe(tasks);
  });

  it("restores from done, as after discarding a staged result", async () => {
    const { fs, tree, snapshot } = await transition(tasks, "T2", "doing");
    await setTaskStatus(fs, tree, { feature: "auth", task: "T2" }, "done");
    await restoreTaskStatus(fs, tree, snapshot);
    expect(await fs.readFile(file)).toBe(tasks);
  });

  it("restores CRLF files exactly", async () => {
    const text = "## T1: Task []\r\nstatus: todo\r\n\r\n## T2: Other []\r\nfiles: x\r\n";
    for (const task of ["T1", "T2"]) {
      const { fs, tree, snapshot } = await transition(text, task, "doing");
      await restoreTaskStatus(fs, tree, snapshot);
      expect(await fs.readFile(file)).toBe(text);
    }
  });
});

describe("status with the recorder", () => {
  // task-run/R7: in staged mode the done edit is staged with the other changes.
  it("stages the done edit with the run's changes", async () => {
    const dir = toPosixPath(mkdtempSync(join(tmpdir(), "specflow-status-")));
    try {
      cpSync(fileURLToPath(new URL("../../../../fixtures/repos/clean", import.meta.url)), dir, { recursive: true });
      const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
      const fs = new NodeFileSystem();
      const loaded = await loadSpecTree(fs, dir);
      if (!loaded.ok) throw new Error(loaded.error.message);
      const tree: SpecTree = loaded.value;
      const target = { feature: "accounts", task: "T3" };

      await setTaskStatus(fs, tree, target, "doing");
      writeFileSync(join(dir, "src/auth/lockout.ts"), "export const attempts = 5;\n");
      await setTaskStatus(fs, tree, target, "done");
      const recorded = await recordRun({ git: new NodeGit({ cwd: dir }), fs }, tree, target, {
        ok: true,
        files: ["src/auth/lockout.ts", tasksFile(tree, "accounts")],
      });

      expect(recorded.ok && recorded.value.mode).toBe("staged");
      expect(git("diff", "--cached", "--name-only").trim().split("\n")).toEqual([".specs/accounts/tasks.md", "src/auth/lockout.ts"]);
      const diff = git("diff", "--cached", "-U0", "--", ".specs/accounts/tasks.md");
      expect(diff.split("\n").filter((l) => /^[-+][^-+]/.test(l))).toEqual(["-status: todo", "+status: done"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
