import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { MemoryFileSystem } from "./fs.js";
import { initSpecs } from "./init.js";
import { lint } from "./lint/lint.js";
import { loadSpecTree } from "./load.js";
import { specTemplates } from "./templates/templates.js";

const templatePaths = Object.keys(specTemplates);

function repo() {
  return new MemoryFileSystem({ "/repo/.git/HEAD": "", "/repo/src/main.ts": "" });
}

describe("initSpecs", () => {
  // core-spec-model/R7: init creates the folder and templates, and lint passes.
  it("creates every template in a repo without specs", async () => {
    const fs = repo();
    expect(await initSpecs(fs, "/repo")).toEqual({
      ok: true,
      value: { root: "/repo", created: templatePaths, skipped: [] },
    });
    for (const path of templatePaths) {
      expect(await fs.readFile(`/repo/${path}`)).toBe(specTemplates[path]);
    }
  });

  it("produces a tree that loads and passes lint", async () => {
    const fs = repo();
    await initSpecs(fs, "/repo");
    const tree = await loadSpecTree(fs, "/repo/src");
    if (!tree.ok) throw new Error(tree.error.message);
    expect(tree.value.features.map((f) => f.name)).toEqual(["example"]);
    expect(lint(tree.value)).toEqual([]);
  });

  it("writes a config.yml that matches the defaults", async () => {
    const fs = repo();
    await initSpecs(fs, "/repo");
    const config = await loadConfig(fs, "/repo");
    expect(config.ok && config.value.commit).toEqual({ mode: "staged", trailers: true });
  });

  // core-spec-model/R7: a second init refuses without --force.
  it("refuses when specs already exist, without writing anything", async () => {
    const fs = repo();
    await fs.writeFile("/repo/.specs/product.md", "mine");
    const result = await initSpecs(fs, "/repo");
    expect(result).toMatchObject({ ok: false, error: { kind: "already-initialized", root: "/repo" } });
    expect(await fs.exists("/repo/.specs/tech.md")).toBe(false);
  });

  it("refuses from a subdirectory of an existing spec root", async () => {
    const fs = repo();
    await initSpecs(fs, "/repo");
    expect(await initSpecs(fs, "/repo/src")).toMatchObject({ ok: false, error: { root: "/repo" } });
    expect(await fs.exists("/repo/src/.specs")).toBe(false);
  });

  // core-spec-model/R7: --force never overwrites existing files.
  it("with force, adds only the missing files", async () => {
    const fs = new MemoryFileSystem({ "/repo/.git/HEAD": "", "/repo/.specs/product.md": "edited" });
    expect(await initSpecs(fs, "/repo", { force: true })).toEqual({
      ok: true,
      value: {
        root: "/repo",
        created: templatePaths.filter((p) => p !== ".specs/product.md"),
        skipped: [".specs/product.md"],
      },
    });
    expect(await fs.readFile("/repo/.specs/product.md")).toBe("edited");
  });

  it("with force on a complete tree, changes nothing", async () => {
    const fs = repo();
    await initSpecs(fs, "/repo");
    await fs.writeFile("/repo/.specs/example/tasks.md", "edited");
    expect(await initSpecs(fs, "/repo", { force: true })).toEqual({
      ok: true,
      value: { root: "/repo", created: [], skipped: templatePaths },
    });
    expect(await fs.readFile("/repo/.specs/example/tasks.md")).toBe("edited");
  });
});
