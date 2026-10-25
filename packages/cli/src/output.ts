import { type Location, loadSpecTree, type SpecTree, toPosixPath } from "@specflow/core";
import { exitCodes, type Io } from "./program.js";

/** `path` relative to `root`, with forward slashes. Paths outside `root` stay absolute. */
export function relativePath(root: string, path: string): string {
  const file = toPosixPath(path);
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
}

/** Makes `location.file` relative to `root`, which is how output reports locations. */
export function relative(root: string, location: Location): Location {
  return { ...location, file: relativePath(root, location.file) };
}

/** `file:start` or `file:start-end`. */
export function formatLocation(location: Location): string {
  const { file, startLine, endLine } = location;
  return startLine === endLine ? `${file}:${startLine}` : `${file}:${startLine}-${endLine}`;
}

/** Writes `value` as pretty JSON with a trailing newline. */
export function writeJson(io: Io, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

/** Pads every column but the last to the width of its longest cell. */
export function table(rows: string[][], indent = "  "): string {
  const widths = rows.reduce<number[]>(
    (acc, row) => row.map((cell, i) => Math.max(acc[i] ?? 0, cell.length)),
    [],
  );
  return rows
    .map((row) => indent + row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  "))
    .join("\n");
}

/**
 * Loads the spec tree from `io.cwd`. On failure, reports the error (as JSON
 * with `schema` when `json` is set) and returns the exit code instead.
 */
export async function loadOrReport(io: Io, schema: string, json: boolean): Promise<SpecTree | number> {
  const result = await loadSpecTree(io.fs, io.cwd);
  if (result.ok) return result.value;
  if (json) {
    writeJson(io, { schema, error: { kind: result.error.kind, message: result.error.message } });
  } else {
    io.stderr(`specflow: ${result.error.message}\n`);
  }
  return exitCodes.unusable;
}
