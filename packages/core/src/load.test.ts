import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "./config.js";
import { MemoryFileSystem } from "./fs.js";
import { findRoot, loadSpecTree } from "./load.js";
import { NodeFileSystem } from "./node/fs.js";
import { toPosixPath } from "./paths.js";

const requirements = "## R1: Do it\nstatus: approved\n";
const tasks = "## T1: Build it [R1]\n";

function repo(files: Record<string, string>) {
  return new MemoryFileSystem({ "/repo/.git/HEAD": "ref: refs/heads/main\n", ...files });
}

async function load(fs: MemoryFileSystem, from = "/repo") {
  const result = await loadSpecTree(fs, from);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("findRoot", () => {
  it("walks up to the nearest folder with .specs/", async () => {
    const fs = repo({ "/repo/.specs/a/tasks.md": tasks, "/repo/src/deep/file.ts": "" });
    expect(await findRoot(fs, "/repo/src/deep")).toBe("/repo");
  });

  it("stops at a .git boundary", async () => {
    const fs = repo({ "/repo/.specs/a/tasks.md": tasks, "/repo/vendor/lib/.git/HEAD": "", "/repo/vendor/lib/x.ts": "" });
    expect(await findRoot(fs, "/repo/vendor/lib")).toBeUndefined();
  });

  it("accepts Windows drive paths with backslashes", async () => {
    const fs = new MemoryFileSystem({ "C:/repo/.specs/a/tasks.md": tasks, "C:/repo/src/x.ts": "" });
    expect(await findRoot(fs, "C:\\repo\\src")).toBe("C:/repo");
  });

  it("accepts UNC paths such as a WSL folder opened from Windows", async () => {
    const fs = new MemoryFileSystem({ "//wsl$/Ubuntu/home/me/repo/.specs/a/tasks.md": tasks });
    expect(await findRoot(fs, "\\\\wsl$\\Ubuntu\\home\\me\\repo\\src")).toBe("//wsl$/Ubuntu/home/me/repo");
  });

  it("does not mistake the root for a UNC path when walking up", async () => {
    const seen: string[] = [];
    const fs = new MemoryFileSystem({ "/tmp/empty/x.ts": "" });
    const spy = { ...fs, readFile: fs.readFile.bind(fs), writeFile: fs.writeFile.bind(fs), listDir: fs.listDir.bind(fs), size: fs.size.bind(fs), exists: (p: string) => (seen.push(p), fs.exists(p)) };
    expect(await findRoot(spy, "/tmp/empty")).toBeUndefined();
    expect(seen).toContain("/.specs");
    expect(seen.some((p) => p.startsWith("//"))).toBe(false);
  });

  it("returns undefined when there are no specs anywhere", async () => {
    expect(await findRoot(new MemoryFileSystem({ "/a/b.txt": "" }), "/a")).toBeUndefined();
  });
});

describe("loadSpecTree", () => {
  // core-spec-model/R3
  it("loads every feature in folder-name order from a subdirectory", async () => {
    const fs = repo({
      "/repo/.specs/config.yml": "commit:\n  mode: auto\n",
      "/repo/.specs/zeta/requirements.md": requirements,
      "/repo/.specs/alpha/requirements.md": requirements,
      "/repo/.specs/alpha/tasks.md": tasks,
      "/repo/.specs/alpha/design.md": "# Design\n\nText.\n\n",
      "/repo/.specs/product.md": "# Product\n",
      "/repo/src/app/main.ts": "",
    });
    const tree = await load(fs, "/repo/src/app");

    expect(tree.root).toBe("/repo");
    expect(tree.config.commit.mode).toBe("auto");
    expect(tree.features.map((f) => f.name)).toEqual(["alpha", "zeta"]);

    const [alpha, zeta] = tree.features;
    expect(alpha).toMatchObject({ dir: "/repo/.specs/alpha", findings: [] });
    expect(alpha!.requirements.map((r) => [r.feature, r.id])).toEqual([["alpha", "R1"]]);
    expect(alpha!.tasks.map((t) => [t.id, t.reqs])).toEqual([["T1", ["R1"]]]);
    expect(alpha!.requirements[0]!.location.file).toBe("/repo/.specs/alpha/requirements.md");
    expect(alpha!.design).toEqual({
      markdown: "# Design\n\nText.\n\n",
      location: { file: "/repo/.specs/alpha/design.md", startLine: 1, endLine: 3 },
    });
    expect(zeta!.tasks).toEqual([]);
    expect(zeta!.design).toBeUndefined();
  });

  it("uses defaults when config.yml is missing", async () => {
    const tree = await load(repo({ "/repo/.specs/a/tasks.md": tasks }));
    expect(tree.config).toEqual(defaultConfig);
  });

  it("uses the configured specsDir and ID prefixes", async () => {
    const fs = repo({
      "/repo/.specs/config.yml": "specsDir: docs/specs\nids:\n  requirement: REQ\n",
      "/repo/docs/specs/a/requirements.md": "## REQ1: Custom\n## R2: Not an item\n",
    });
    const tree = await load(fs);
    expect(tree.features[0]!.requirements.map((r) => r.id)).toEqual(["REQ1"]);
  });

  it("skips hidden folders", async () => {
    const fs = repo({ "/repo/.specs/a/tasks.md": tasks, "/repo/.specs/.drafts/tasks.md": tasks });
    expect((await load(fs)).features.map((f) => f.name)).toEqual(["a"]);
  });

  it("keeps parse findings on the feature", async () => {
    const fs = repo({ "/repo/.specs/a/requirements.md": "## R1 no colon\n", "/repo/.specs/a/tasks.md": "## T1 no colon\n" });
    const [feature] = (await load(fs)).features;
    expect(feature!.findings.map((f) => [f.rule, f.location.file])).toEqual([
      ["malformed-heading", "/repo/.specs/a/requirements.md"],
      ["malformed-heading", "/repo/.specs/a/tasks.md"],
    ]);
  });

  it("fails when no .specs/ is found", async () => {
    const result = await loadSpecTree(new MemoryFileSystem({ "/x/y.ts": "" }), "/x");
    expect(result).toMatchObject({ ok: false, error: { kind: "no-specs", from: "/x" } });
  });

  it("fails with the config error when config.yml is invalid", async () => {
    const result = await loadSpecTree(repo({ "/repo/.specs/config.yml": "commit:\n  mode: yolo\n" }), "/repo");
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid-config" } });
    expect(!result.ok && result.error.message).toContain("commit.mode");
  });

  it("fails when specsDir does not exist", async () => {
    const result = await loadSpecTree(repo({ "/repo/.specs/config.yml": "specsDir: nowhere\n" }), "/repo");
    expect(result).toMatchObject({ ok: false, error: { kind: "missing-specs-dir", path: "/repo/nowhere" } });
  });

  it("loads the clean fixture repo from a nested directory", async () => {
    const root = fileURLToPath(new URL("../../../fixtures/repos/clean", import.meta.url));
    const result = await loadSpecTree(new NodeFileSystem(), `${root}/src/auth`);
    if (!result.ok) throw new Error(result.error.message);
    const tree = result.value;

    expect(tree.root).toBe(toPosixPath(root));
    expect(tree.features.map((f) => f.name)).toEqual(["accounts", "billing"]);
    expect(tree.features.map((f) => [f.requirements.length, f.tasks.length, f.design !== undefined])).toEqual([
      [4, 3, true],
      [1, 1, true],
    ]);
    expect(tree.features.flatMap((f) => f.findings)).toEqual([]);
  });
});
