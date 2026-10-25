import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AdapterRegistry, FakeClock, toPosixPath } from "@specflow/core";
import { NodeFileSystem, NodeGit } from "@specflow/core/node";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "./program.js";

const reposDir = toPosixPath(fileURLToPath(new URL("../../../fixtures/repos", import.meta.url)));

function quietIo(cwd: string) {
  return {
    cwd,
    fs: new NodeFileSystem(),
    git: new NodeGit({ cwd }),
    registry: new AdapterRegistry(),
    clock: new FakeClock(),
    stdout: () => {},
    stderr: () => {},
    onInterrupt: () => () => {},
  };
}

// Runs the CLI in-process. Absolute fixture paths become <root> so snapshots match on every machine.
async function specflow(fixture: string, ...argv: string[]) {
  return specflowIn(`${reposDir}/${fixture}`, `${reposDir}/${fixture}/src`, ...argv);
}

async function specflowIn(root: string, cwd: string, ...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await run(argv, {
    ...quietIo(cwd),
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  const clean = (text: string) => text.replaceAll(JSON.stringify(root).slice(1, -1), "<root>").replaceAll(root, "<root>");
  return { code, stdout: clean(stdout), stderr: clean(stderr) };
}

describe("specflow init", () => {
  let dir = "";
  afterEach(() => rm(dir, { recursive: true, force: true }));

  async function emptyRepo() {
    dir = toPosixPath(await mkdtemp(join(tmpdir(), "specflow-init-")));
    return dir;
  }

  // core-spec-model/R7: init then lint passes.
  it("creates .specs/ that passes lint", async () => {
    const root = await emptyRepo();
    const init = await specflowIn(root, root, "init");
    expect(init.code).toBe(0);
    expect(init.stdout).toMatchSnapshot();
    expect(await specflowIn(root, root, "lint")).toEqual({ code: 0, stdout: "No problems found.\n", stderr: "" });
  });

  // core-spec-model/R7: a second init refuses without --force and never overwrites.
  it("refuses a second time without --force", async () => {
    const root = await emptyRepo();
    await specflowIn(root, root, "init");
    await writeFile(`${root}/.specs/product.md`, "edited");
    expect(await specflowIn(root, root, "init")).toEqual({
      code: 1,
      stdout: "",
      stderr:
        "specflow: .specs/ already exists in <root>. Run with --force to add missing files; existing files are never overwritten.\n",
    });
    expect(await readFile(`${root}/.specs/product.md`, "utf8")).toBe("edited");
  });

  it("with --force adds missing files and keeps the rest", async () => {
    const root = await emptyRepo();
    await specflowIn(root, root, "init");
    await writeFile(`${root}/.specs/product.md`, "edited");
    await unlink(`${root}/.specs/tech.md`);
    const result = await specflowIn(root, root, "init", "--force", "--json");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      schema: "specflow.init/v1",
      root: "<root>",
      created: [".specs/tech.md"],
      skipped: [
        ".specs/README.md",
        ".specs/product.md",
        ".specs/config.yml",
        ".specs/example/requirements.md",
        ".specs/example/design.md",
        ".specs/example/tasks.md",
      ],
    });
    expect(await readFile(`${root}/.specs/product.md`, "utf8")).toBe("edited");
  });
});

describe("specflow lint", () => {
  it("reports no problems on the clean fixture", async () => {
    const result = await specflow("clean", "lint");
    expect(result).toEqual({ code: 0, stdout: "No problems found.\n", stderr: "" });
  });

  // core-spec-model/R5: errors exit 1, text and JSON output.
  it.each(["malformed-heading", "duplicate-id", "unknown-ref", "dependency-cycle"])(
    "exits 1 on the %s fixture",
    async (fixture) => {
      const text = await specflow(fixture, "lint");
      const json = await specflow(fixture, "lint", "--json");
      expect(text.code).toBe(1);
      expect(json.code).toBe(1);
      expect(text.stdout).toMatchSnapshot("text");
      expect(json.stdout).toMatchSnapshot("json");
    },
  );

  it("exits 0 when there are only warnings", async () => {
    const result = await specflow("orphan-requirement", "lint");
    expect(result.code).toBe(0);
    expect(result.stdout).toMatchSnapshot();
  });

  it("prints a versioned JSON document", async () => {
    const { stdout } = await specflow("clean", "lint", "--json");
    expect(JSON.parse(stdout)).toEqual({
      schema: "specflow.lint/v1",
      root: "<root>",
      summary: { errors: 0, warnings: 0, infos: 0 },
      findings: [],
    });
  });
});

describe("specflow show", () => {
  it.each([["accounts"], ["accounts/R1"], ["accounts/T2"], ["billing/T1"]])("shows %s", async (target) => {
    const text = await specflow("clean", "show", target);
    const json = await specflow("clean", "show", target, "--json");
    expect(text.code).toBe(0);
    expect(json.code).toBe(0);
    expect(text.stdout).toMatchSnapshot("text");
    expect(json.stdout).toMatchSnapshot("json");
  });

  it("marks unknown requirement references", async () => {
    const { stdout } = await specflow("unknown-ref", "show", "billing/T1");
    expect(stdout).toMatch(/^ {2}R7 +unknown +-$/m);
  });

  it.each([
    ["nope", "specflow: No feature nope. Features: accounts, billing\n"],
    ["accounts/R9", "specflow: No requirement or task R9 in feature accounts\n"],
  ])("exits 1 when %s does not exist", async (target, message) => {
    expect(await specflow("clean", "show", target)).toEqual({ code: 1, stdout: "", stderr: message });
    const json = await specflow("clean", "show", target, "--json");
    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout)).toEqual({ schema: "specflow.show/v1", error: { kind: "not-found", message: message.slice(10, -1) } });
  });
});

describe("specflow", () => {
  it("exits 2 when no specs are found", async () => {
    let stderr = "";
    const code = await run(["lint"], { ...quietIo("/"), stderr: (text) => (stderr += text) });
    expect(code).toBe(2);
    expect(stderr).toBe("specflow: No .specs/ folder found at or above /\n");
  });

  it("exits 2 on an unknown command", async () => {
    const result = await specflow("clean", "nope");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown command 'nope'");
  });
});
