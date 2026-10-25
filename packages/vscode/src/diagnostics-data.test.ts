import type { Finding } from "@specflow/core";
import { describe, expect, it } from "vitest";
import { findingsByFile } from "./diagnostics-data.js";

const finding = (rule: string, file: string, line: number, severity: Finding["severity"] = "error"): Finding => ({
  rule,
  severity,
  message: `${rule} message`,
  location: { file, startLine: line, endLine: line },
  feature: "a",
});

describe("findingsByFile", () => {
  // vscode-extension/R3: on the right file and line, with the rule ID as the code.
  it("groups findings by file with rule codes and 1-based lines", () => {
    const byFile = findingsByFile([
      finding("unknown-ref", "/r/.specs/a/tasks.md", 3),
      finding("orphan-requirement", "/r/.specs/a/requirements.md", 7, "warning"),
      finding("duplicate-id", "/r/.specs/a/tasks.md", 9),
    ]);
    expect([...byFile.keys()]).toEqual(["/r/.specs/a/tasks.md", "/r/.specs/a/requirements.md"]);
    expect(byFile.get("/r/.specs/a/tasks.md")).toEqual([
      { startLine: 3, endLine: 3, message: "unknown-ref message", severity: "error", code: "unknown-ref" },
      { startLine: 9, endLine: 9, message: "duplicate-id message", severity: "error", code: "duplicate-id" },
    ]);
    expect(byFile.get("/r/.specs/a/requirements.md")?.[0]?.severity).toBe("warning");
  });

  it("is empty without findings", () => {
    expect(findingsByFile([]).size).toBe(0);
  });
});
