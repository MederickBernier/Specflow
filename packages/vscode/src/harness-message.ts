import type { HarnessCheck, HarnessCheckError, Result, UnknownAdapterError } from "@specflow/core";

/** What to tell the user about the harness, independent of the VS Code API. */
export type HarnessMessage =
  | { level: "none" }
  | { level: "info"; text: string }
  | { level: "warning"; text: string; installUrl?: string };

/** Button that opens the install docs. */
export const installButton = "Open install docs";

/**
 * The message for a harness check (vscode-extension/R8): problems as a
 * warning with the install docs link, version warnings as information, and
 * nothing when all is well, unless `quiet` is false.
 */
export function harnessMessage(
  result: Result<{ name: string; check: Result<HarnessCheck, HarnessCheckError> }, UnknownAdapterError>,
  options: { quiet: boolean },
): HarnessMessage {
  if (!result.ok) return { level: "warning", text: `Specflow: ${result.error.message}. Set specflow.harness or harness.default in .specs/config.yml.` };
  const { name, check } = result.value;
  if (!check.ok) {
    const hint = check.error.kind === "not-authenticated" ? " Sign in, then try again." : "";
    return {
      level: "warning",
      text: `Specflow can't run tasks: ${check.error.message}${hint}`,
      ...(check.error.installUrl && { installUrl: check.error.installUrl }),
    };
  }
  if (check.value.warnings.length > 0) return { level: "info", text: `Specflow: ${name} ${check.value.version}: ${check.value.warnings.join("; ")}` };
  return options.quiet ? { level: "none" } : { level: "info", text: `Specflow: ${name} ${check.value.version} is ready.` };
}
