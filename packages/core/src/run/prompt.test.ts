import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../fs.js";
import { loadSpecTree } from "../load.js";
import { NodeFileSystem } from "../node/fs.js";
import { toPosixPath } from "../paths.js";
import { buildTaskPrompt } from "./prompt.js";

const cleanRoot = toPosixPath(fileURLToPath(new URL("../../../../fixtures/repos/clean", import.meta.url)));

async function cleanPrompt(feature: string, task: string) {
  const fs = new NodeFileSystem();
  const tree = await loadSpecTree(fs, cleanRoot);
  if (!tree.ok) throw new Error(tree.error.message);
  const prompt = await buildTaskPrompt(fs, tree.value, { feature, task });
  if (!prompt.ok) throw new Error(prompt.error.message);
  return prompt.value;
}

async function memoryPrompt(files: Record<string, string>, feature: string, task: string) {
  const fs = new MemoryFileSystem({
    "/repo/.git/HEAD": "",
    ...Object.fromEntries(Object.entries(files).map(([path, text]) => [`/repo/.specs/${path}`, text])),
  });
  const tree = await loadSpecTree(fs, "/repo");
  if (!tree.ok) throw new Error(tree.error.message);
  return buildTaskPrompt(fs, tree.value, { feature, task });
}

describe("buildTaskPrompt", () => {
  // task-run/R3: steering, task, referenced requirements, design, instruction.
  it("builds the prompt for accounts/T3 on the clean fixture", async () => {
    expect(await cleanPrompt("accounts", "T3")).toMatchSnapshot();
  });

  it("includes each section once, in order", async () => {
    const prompt = await cleanPrompt("accounts", "T3");
    const order = ["<steering>", '<task id="accounts/T3">', "<requirements>", '<requirement id="accounts/R2">', "<design>", "Work on this task only;"];
    const positions = order.map((marker) => prompt.indexOf(marker));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(prompt).toContain("# Product");
    expect(prompt).toContain("# Tech");
    expect(prompt).toContain("## T3: Add lockout counter [R2]\nstatus: todo\nfiles: src/auth/login.ts, src/auth/lockout.ts");
    expect(prompt).toContain("## R2: Lock out after failed attempts\npriority: should\nstatus: approved");
    expect(prompt).toContain("The lockout counter lives in memory");
    expect(prompt).toContain("If the design cannot work as written, stop and explain why.");
    expect(prompt.endsWith("\n")).toBe(true);
    // accounts/T1 and T2 are done, so nothing is out of scope.
    expect(prompt).not.toContain("<out-of-scope>");
  });

  it("includes only the requirements the task references", async () => {
    const prompt = await cleanPrompt("accounts", "T3");
    expect(prompt).not.toContain("## R1:");
    expect(prompt).not.toContain("## R3:");
    expect(prompt).not.toContain("## T2:");
  });

  // task-run/R3: other open tasks are named as out of scope, by ID and title only.
  it("lists the feature's other open tasks as out of scope", async () => {
    const result = await memoryPrompt(
      {
        "a/tasks.md":
          "## T1: Done already []\nstatus: done\n\n## T2: This one []\n\n## T3: Later [R1]\nstatus: todo\n\nLater body.\n\n## T4: Blocked []\nstatus: blocked\n",
        "a/requirements.md": "## R1: Req\nstatus: approved\n",
        "b/tasks.md": "## T1: Other feature []\n",
      },
      "a",
      "T2",
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toContain(
      "<out-of-scope>\nOther open tasks in this feature, each done in its own run:\n- T3: Later\n- T4: Blocked\n</out-of-scope>",
    );
    expect(result.value).not.toContain("Done already");
    expect(result.value).not.toContain("Later body.");
    expect(result.value).not.toContain("Other feature");
  });

  // task-run/R3, R7: no spec edits, specflow owns the status; spec notes requested.
  it("forbids spec edits and asks for spec notes", async () => {
    const prompt = await cleanPrompt("accounts", "T3");
    expect(prompt).toContain("Do not edit files under .specs/; specflow updates this task's status.");
    expect(prompt).not.toContain("except to set this task's status");
    expect(prompt).toContain('end your final reply with a "Spec notes:" section');
  });

  // task-run/R3: other features' specs never appear.
  it("leaves out other features' specs", async () => {
    const prompt = await cleanPrompt("billing", "T1");
    expect(prompt).toContain("## R1: Pay for an order");
    expect(prompt).toContain("A single `pay` function");
    for (const text of ["Sign in with email", "Lock out", "lockout counter", "Sessions are signed cookies", "auth module"]) {
      expect(prompt).not.toContain(text);
    }
  });

  it("omits the requirements block for a task with no references", async () => {
    const prompt = await cleanPrompt("accounts", "T1");
    expect(prompt).not.toContain("<requirements>");
    expect(prompt).toContain('<task id="accounts/T1">');
  });

  it("includes an explicitly referenced requirement from another feature, but not that feature's design", async () => {
    const result = await memoryPrompt(
      {
        "auth/requirements.md": "## R1: Sign in\nstatus: approved\n\nAuth text.\n",
        "auth/design.md": "Auth design.\n",
        "billing/requirements.md": "## R1: Pay\nstatus: approved\n",
        "billing/tasks.md": "## T1: Pay after sign in [R1, auth/R1]\n",
      },
      "billing",
      "T1",
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toContain('<requirement id="billing/R1">\n## R1: Pay');
    expect(result.value).toContain('<requirement id="auth/R1">\n## R1: Sign in\nstatus: approved\n\nAuth text.\n</requirement>');
    expect(result.value).not.toContain("Auth design.");
  });

  it("leaves out missing steering and design files, and an empty out-of-scope list", async () => {
    const result = await memoryPrompt({ "a/tasks.md": "## T1: Lone task []\n\nDo it.\n" }, "a", "T1");
    expect(result).toEqual({
      ok: true,
      value:
        '<task id="a/T1">\n## T1: Lone task []\n\nDo it.\n</task>\n\n' +
        "Work on this task only; leave the out-of-scope tasks for their own runs.\n" +
        "Do not edit files under .specs/; specflow updates this task's status.\n" +
        "If the design cannot work as written, stop and explain why.\n" +
        'If you found problems in the spec or made decisions it does not cover, end your final reply with a "Spec notes:" section listing them as bullets.\n',
    });
  });

  it("uses the configured specsDir in the instruction", async () => {
    const fs = new MemoryFileSystem({
      "/repo/.git/HEAD": "",
      "/repo/.specs/config.yml": "specsDir: docs/specs\n",
      "/repo/docs/specs/a/tasks.md": "## T1: Task []\n",
    });
    const tree = await loadSpecTree(fs, "/repo");
    if (!tree.ok) throw new Error(tree.error.message);
    const result = await buildTaskPrompt(fs, tree.value, { feature: "a", task: "T1" });
    expect(result.ok && result.value).toContain("Do not edit files under docs/specs/; specflow");
  });

  it("fails on an unknown task", async () => {
    const result = await memoryPrompt({ "a/tasks.md": "## T1: Task []\n" }, "a", "T9");
    expect(result).toEqual({ ok: false, error: { kind: "unknown-task", message: "No task a/T9" } });
  });

  it("fails on an unknown referenced requirement", async () => {
    const result = await memoryPrompt({ "a/tasks.md": "## T1: Task [R7]\n" }, "a", "T1");
    expect(result).toEqual({
      ok: false,
      error: { kind: "unknown-requirement", message: "Task a/T1 references unknown requirement R7" },
    });
  });
});
