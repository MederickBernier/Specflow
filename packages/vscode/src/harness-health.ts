import { AdapterRegistry, type Config, defaultConfig, type HarnessAdapter, type HarnessCheck, type HarnessCheckError, type Result, type UnknownAdapterError } from "@specflow/core";
import * as vscode from "vscode";
import { harnessMessage, installButton } from "./harness-message.js";

/** What the last harness check found, for views that show harness health. */
export type HarnessReport = { ready: boolean; harness?: string; version?: string; warnings?: string[]; message?: string; installUrl?: string };

let lastReport: HarnessReport | undefined;
const checked = new vscode.EventEmitter<HarnessReport>();

/** Fires after every harness check. */
export const onDidCheckHarness = checked.event;

/** The result of the last harness check, if one ran. */
export function lastHarnessCheck(): HarnessReport | undefined {
  return lastReport;
}

/** `specflow.harness` overrides `harness.default` for this machine. */
export function harnessOverride(): string {
  return vscode.workspace.getConfiguration("specflow").get<string>("harness", "");
}

/** The adapter a run would use, honoring the setting. */
export function resolveHarness(registry: AdapterRegistry, config: Config = defaultConfig): Result<HarnessAdapter, UnknownAdapterError> {
  return registry.resolve(config, harnessOverride() || undefined);
}

/**
 * Checks the harness and tells the user what is wrong, with a button to the
 * install docs (vscode-extension/R8). `quiet` hides the success message.
 * Returns whether a run can go ahead, plus the raw check for callers.
 */
export async function checkHarness(
  registry: AdapterRegistry,
  config: Config | undefined,
  options: { quiet: boolean },
): Promise<{ ready: boolean; check?: Result<HarnessCheck, HarnessCheckError>; harness?: string }> {
  const adapter = resolveHarness(registry, config);
  const check = adapter.ok ? await adapter.value.check() : undefined;
  const message = harnessMessage(
    adapter.ok ? { ok: true, value: { name: adapter.value.name, check: check! } } : adapter,
    options,
  );
  // Notifications resolve only when the user acts on them, so they are never awaited here.
  if (message.level === "warning") {
    const { installUrl } = message;
    if (installUrl) {
      void vscode.window.showWarningMessage(message.text, installButton).then((choice) => {
        if (choice === installButton) void vscode.env.openExternal(vscode.Uri.parse(installUrl));
      });
    } else {
      void vscode.window.showWarningMessage(message.text);
    }
  } else if (message.level === "info") {
    void vscode.window.showInformationMessage(message.text);
  }
  const ready = adapter.ok && check!.ok;
  lastReport = {
    ready,
    ...(adapter.ok && { harness: adapter.value.name }),
    ...(check?.ok && { version: check.value.version, warnings: check.value.warnings }),
    ...(!ready && message.level === "warning" && { message: message.text }),
    ...(message.level === "warning" && message.installUrl && { installUrl: message.installUrl }),
  };
  checked.fire(lastReport);
  return {
    ready,
    ...(check && { check }),
    ...(adapter.ok && { harness: adapter.value.name }),
  };
}
