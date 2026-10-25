import { defaultConfig, loadSpecTree } from "@specflow/core";
import { writeJson } from "../output.js";
import { exitCodes, type Io } from "../program.js";

/** JSON schema ID of `specflow harness check --json`. Bump the version on breaking changes. */
export const harnessSchema = "specflow.harness/v1";

/**
 * `specflow harness check`: whether the configured harness can run. Works
 * outside a spec repo too, using the default config.
 */
export async function harnessCheckCommand(io: Io, options: { harness?: string; json: boolean }): Promise<number> {
  const tree = await loadSpecTree(io.fs, io.cwd);
  const config = tree.ok ? tree.value.config : defaultConfig;

  const adapter = io.registry.resolve(config, options.harness);
  if (!adapter.ok) {
    if (options.json) writeJson(io, { schema: harnessSchema, error: { kind: adapter.error.kind, message: adapter.error.message } });
    else io.stderr(`specflow: ${adapter.error.message}\n`);
    return exitCodes.failed;
  }

  const check = await adapter.value.check();
  if (options.json) {
    writeJson(io, {
      schema: harnessSchema,
      harness: adapter.value.name,
      ...(check.ok ? { ok: true, ...check.value } : { ok: false, error: check.error }),
    });
    return check.ok ? exitCodes.ok : exitCodes.failed;
  }

  if (!check.ok) {
    const install = check.error.installUrl ? `\nSee ${check.error.installUrl}` : "";
    io.stderr(`specflow: ${adapter.value.name}: ${check.error.message}${install}\n`);
    return exitCodes.failed;
  }
  io.stdout(`${adapter.value.name} ${check.value.version}: ready\n`);
  for (const warning of check.value.warnings) io.stdout(`  warning: ${warning}\n`);
  return exitCodes.ok;
}
