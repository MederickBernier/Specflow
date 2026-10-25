import { initSpecs } from "@specflow/core";
import { writeJson } from "../output.js";
import { exitCodes, type Io } from "../program.js";

/** JSON schema ID of `specflow init --json`. Bump the version on breaking changes. */
export const initSchema = "specflow.init/v1";

/** `specflow init`: scaffolds `.specs/` in the working directory; returns 1 when it refuses. */
export async function initCommand(io: Io, options: { force: boolean; json: boolean }): Promise<number> {
  const result = await initSpecs(io.fs, io.cwd, { force: options.force });

  if (!result.ok) {
    if (options.json) {
      writeJson(io, { schema: initSchema, error: { kind: result.error.kind, message: result.error.message } });
    } else {
      io.stderr(`specflow: ${result.error.message}\n`);
    }
    return exitCodes.failed;
  }

  const { root, created, skipped } = result.value;
  if (options.json) {
    writeJson(io, { schema: initSchema, root, created, skipped });
  } else if (created.length === 0) {
    io.stdout("Nothing to add: every template file already exists.\n");
  } else {
    const verb = skipped.length === 0 ? "Created" : "Added";
    io.stdout(`${verb} ${created.length} file${created.length === 1 ? "" : "s"}:\n`);
    for (const path of created) io.stdout(`  ${path}\n`);
    if (skipped.length > 0) io.stdout(`Kept ${skipped.length} existing file${skipped.length === 1 ? "" : "s"}.\n`);
    io.stdout("\nNext: edit .specs/product.md and .specs/tech.md, then run `specflow lint`.\n");
  }
  return exitCodes.ok;
}
