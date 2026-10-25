import type { Finding } from "@specflow/core";

/** A diagnostic before it becomes a `vscode.Diagnostic`; lines are 1-based. */
export type DiagnosticData = {
  startLine: number;
  endLine: number;
  message: string;
  severity: Finding["severity"];
  code: string;
};

/** Groups findings by file, in finding order (vscode-extension/R3). */
export function findingsByFile(findings: readonly Finding[]): Map<string, DiagnosticData[]> {
  const byFile = new Map<string, DiagnosticData[]>();
  for (const f of findings) {
    const list = byFile.get(f.location.file) ?? [];
    list.push({
      startLine: f.location.startLine,
      endLine: f.location.endLine,
      message: f.message,
      severity: f.severity,
      code: f.rule,
    });
    byFile.set(f.location.file, list);
  }
  return byFile;
}
