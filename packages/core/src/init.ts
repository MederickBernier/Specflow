import type { FileSystem } from "./fs.js";
import { findRoot } from "./load.js";
import { joinPath, toPosixPath } from "./paths.js";
import { err, ok, type Result } from "./result.js";
import { specTemplates } from "./templates/templates.js";

/** Files `init` wrote and left alone, as paths relative to `root`. */
export type InitResult = { root: string; created: string[]; skipped: string[] };

/** Why `init` refused. */
export type InitError = { kind: "already-initialized"; root: string; message: string };

/**
 * Scaffolds `.specs/` with steering templates, a default `config.yml` and an
 * example feature in `dir`. When a spec root already exists at or above
 * `dir`, refuses unless `force` is set; with `force` it writes only the
 * missing template files into that root. Existing files are never overwritten.
 */
export async function initSpecs(
  fs: FileSystem,
  dir: string,
  options: { force?: boolean } = {},
): Promise<Result<InitResult, InitError>> {
  const existing = await findRoot(fs, dir);
  if (existing !== undefined && !options.force) {
    return err({
      kind: "already-initialized",
      root: existing,
      message: `.specs/ already exists in ${existing}. Run with --force to add missing files; existing files are never overwritten.`,
    });
  }

  const root = existing ?? toPosixPath(dir);
  const created: string[] = [];
  const skipped: string[] = [];
  for (const [path, content] of Object.entries(specTemplates)) {
    const file = joinPath(root, path);
    if (await fs.exists(file)) {
      skipped.push(path);
    } else {
      await fs.writeFile(file, content);
      created.push(path);
    }
  }
  return ok({ root, created, skipped });
}
