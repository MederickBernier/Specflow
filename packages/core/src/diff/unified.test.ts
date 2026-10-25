import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type FileDiff, parseUnifiedDiff, unquotePath } from "./unified.js";

const recorded = (name: string) => readFileSync(new URL(`../../../../fixtures/diffs/${name}`, import.meta.url), "utf8");
const byPath = (files: FileDiff[]) => new Map(files.map((f) => [f.path, f]));

describe("parseUnifiedDiff (workbench-ui/R4, R5)", () => {
  const working = byPath(parseUnifiedDiff(recorded("working.patch")));

  it("finds every file of a recorded patch, in order", () => {
    expect(parseUnifiedDiff(recorded("working.patch")).map((f) => [f.path, f.change])).toEqual([
      ["added.txt", "added"],
      ["blob.bin", "modified"],
      ["gone.txt", "deleted"],
      ["moved.txt", "renamed"],
      ["multi.txt", "modified"],
      ["new-name.txt", "renamed"],
      ["nonl.txt", "modified"],
      ["script.sh", "modified"],
      ["tab\there.txt", "modified"],
      ["with space.txt", "modified"],
      ["é.txt", "modified"],
    ]);
  });

  it("numbers hunk lines on both sides and counts additions and deletions", () => {
    const multi = working.get("multi.txt")!;
    expect([multi.additions, multi.deletions]).toEqual([2, 2]);
    expect(multi.hunks.map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines, h.section])).toEqual([
      [1, 5, 1, 5, undefined],
      [8, 5, 8, 5, "seven"],
    ]);
    expect(multi.hunks[0]!.lines).toEqual([
      { kind: "context", text: "one", oldLine: 1, newLine: 1 },
      { kind: "del", text: "two", oldLine: 2 },
      { kind: "add", text: "TWO", newLine: 2 },
      { kind: "context", text: "three", oldLine: 3, newLine: 3 },
      { kind: "context", text: "four", oldLine: 4, newLine: 4 },
      { kind: "context", text: "five", oldLine: 5, newLine: 5 },
    ]);
    expect(multi.hunks[1]!.lines.find((l) => l.kind === "add")).toEqual({ kind: "add", text: "ELEVEN", newLine: 11 });
  });

  it("reads added and deleted files", () => {
    expect(working.get("added.txt")).toMatchObject({ change: "added", newMode: "100644", additions: 1, deletions: 0 });
    expect(working.get("added.txt")!.hunks[0]!.lines).toEqual([{ kind: "add", text: "new", newLine: 1 }]);
    expect(working.get("gone.txt")).toMatchObject({ change: "deleted", oldMode: "100644", additions: 0, deletions: 1 });
    expect(working.get("gone.txt")!.from).toBeUndefined();
  });

  it("reads renames, with and without edits", () => {
    expect(working.get("moved.txt")).toMatchObject({ from: "pure.txt", change: "renamed", hunks: [] });
    const edited = working.get("new-name.txt")!;
    expect(edited).toMatchObject({ from: "old-name.txt", change: "renamed", additions: 1, deletions: 1 });
    expect(edited.hunks[0]!.lines.filter((l) => l.kind !== "context").map((l) => l.text)).toEqual(["c", "C"]);
  });

  it("marks binary files and mode changes", () => {
    expect(working.get("blob.bin")).toMatchObject({ binary: true, hunks: [], additions: 0, deletions: 0 });
    expect(working.get("script.sh")).toMatchObject({ change: "modified", oldMode: "100644", newMode: "100755", hunks: [] });
  });

  it("marks lines without a final newline", () => {
    expect(working.get("nonl.txt")!.hunks[0]!.lines).toEqual([
      { kind: "del", text: "end", oldLine: 1, noNewline: true },
      { kind: "add", text: "end", newLine: 1 },
      { kind: "add", text: "more", newLine: 2 },
    ]);
  });

  it("reads quoted paths and paths with spaces", () => {
    expect(working.get("é.txt")!.hunks[0]!.lines.map((l) => l.text)).toEqual(["q", "r"]);
    expect(working.get("tab\there.txt")!.additions).toBe(1);
    expect(working.get("with space.txt")!.hunks[0]!.lines.map((l) => l.text)).toEqual(["x", "y"]);
  });

  it("reads a root commit, where every file is added", () => {
    const files = parseUnifiedDiff(recorded("root-commit.patch"));
    expect(files.every((f) => f.change === "added")).toBe(true);
    expect(files.find((f) => f.path === "blob.bin")).toMatchObject({ binary: true, change: "added" });
    expect(files.find((f) => f.path === "nonl.txt")!.hunks[0]!.lines).toEqual([{ kind: "add", text: "end", newLine: 1, noNewline: true }]);
  });

  it("reads CRLF patches", () => {
    const patch = ["diff --git a/w.txt b/w.txt", "index 1..2 100644", "--- a/w.txt", "+++ b/w.txt", "@@ -1,2 +1,2 @@", " keep", "-old", "+new", ""].join("\r\n");
    expect(parseUnifiedDiff(patch)[0]!.hunks[0]!.lines.map((l) => [l.kind, l.text])).toEqual([
      ["context", "keep"],
      ["del", "old"],
      ["add", "new"],
    ]);
  });

  it("reads hunk lines by count, so content that looks like a header stays content", () => {
    const patch = [
      "diff --git a/notes.md b/notes.md",
      "--- a/notes.md",
      "+++ b/notes.md",
      "@@ -1,2 +1,3 @@",
      "--- a/old",
      "+++ b/new",
      "+@@ -9 +9 @@",
      " ",
      "diff --git a/next.md b/next.md",
      "--- a/next.md",
      "+++ b/next.md",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ].join("\n");
    const [notes, next] = parseUnifiedDiff(patch);
    expect(notes!.hunks[0]!.lines.map((l) => [l.kind, l.text])).toEqual([
      ["del", "-- a/old"],
      ["add", "++ b/new"],
      ["add", "@@ -9 +9 @@"],
      ["context", ""],
    ]);
    expect(next!.path).toBe("next.md");
  });

  it("treats a hunk header without counts as one line", () => {
    const [file] = parseUnifiedDiff(["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -3 +3 @@", "-a", "+b"].join("\n"));
    expect(file!.hunks[0]).toMatchObject({ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 });
  });

  it("reads unquoted renames whose names contain spaces from the rename lines", () => {
    const [file] = parseUnifiedDiff(["diff --git a/my file.txt b/your file.txt", "similarity index 100%", "rename from my file.txt", "rename to your file.txt"].join("\n"));
    expect(file).toMatchObject({ path: "your file.txt", from: "my file.txt", change: "renamed" });
  });

  it("returns nothing for empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

describe("unquotePath", () => {
  it("decodes git's C-style quoting", () => {
    expect(unquotePath('"a/\\303\\251.txt"')).toBe("a/é.txt");
    expect(unquotePath('"tab\\there \\"q\\" back\\\\slash"')).toBe('tab\there "q" back\\slash');
    expect(unquotePath("plain name.txt")).toBe("plain name.txt");
  });
});
