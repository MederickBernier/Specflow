import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type FileSystem, MemoryFileSystem } from "./fs.js";
import { NodeFileSystem } from "./node/fs.js";

const tmp = await mkdtemp(join(tmpdir(), "specflow-fs-"));
afterAll(() => rm(tmp, { recursive: true, force: true }));

const implementations: [string, FileSystem, string][] = [
  ["MemoryFileSystem", new MemoryFileSystem({ "/repo/.specs/a/tasks.md": "# a" }), "/repo"],
  ["NodeFileSystem", new NodeFileSystem(), join(tmp, "repo")],
];

describe.each(implementations)("%s", (_name, fs, root) => {
  it("writes and reads back, creating parent directories", async () => {
    await fs.writeFile(join(root, ".specs/b/requirements.md"), "# b\n");
    expect(await fs.readFile(join(root, ".specs/b/requirements.md"))).toBe("# b\n");
  });

  it("overwrites existing files", async () => {
    await fs.writeFile(join(root, "x.md"), "one");
    await fs.writeFile(join(root, "x.md"), "two");
    expect(await fs.readFile(join(root, "x.md"))).toBe("two");
  });

  it("reports a file's size in bytes", async () => {
    await fs.writeFile(join(root, "sized.md"), "é\n");
    expect(await fs.size(join(root, "sized.md"))).toBe(3);
    await expect(fs.size(join(root, "missing.md"))).rejects.toThrow();
  });

  it("rejects reading a missing file", async () => {
    await expect(fs.readFile(join(root, "missing.md"))).rejects.toThrow();
  });

  it("reports existence of files and directories", async () => {
    await fs.writeFile(join(root, ".specs/c/design.md"), "");
    expect(await fs.exists(join(root, ".specs/c/design.md"))).toBe(true);
    expect(await fs.exists(join(root, ".specs/c"))).toBe(true);
    expect(await fs.exists(join(root, ".specs/c/"))).toBe(true);
    expect(await fs.exists(join(root, "nope"))).toBe(false);
  });

  it("lists entry names sorted", async () => {
    await fs.writeFile(join(root, "list/zeta.md"), "");
    await fs.writeFile(join(root, "list/alpha/tasks.md"), "");
    await fs.writeFile(join(root, "list/beta.md"), "");
    expect(await fs.listDir(join(root, "list"))).toEqual(["alpha", "beta.md", "zeta.md"]);
  });

  it("lists only directories when asked", async () => {
    await fs.writeFile(join(root, "dirs/zeta/tasks.md"), "");
    await fs.writeFile(join(root, "dirs/config.yml"), "");
    await fs.writeFile(join(root, "dirs/alpha/deep/design.md"), "");
    expect(await fs.listDir(join(root, "dirs"), { directoriesOnly: true })).toEqual(["alpha", "zeta"]);
  });

  it("returns an empty list for a directory with no subdirectories", async () => {
    await fs.writeFile(join(root, "flat/a.md"), "");
    expect(await fs.listDir(join(root, "flat"), { directoriesOnly: true })).toEqual([]);
  });

  it("rejects listing a missing directory", async () => {
    await expect(fs.listDir(join(root, "nowhere"))).rejects.toThrow();
  });
});
