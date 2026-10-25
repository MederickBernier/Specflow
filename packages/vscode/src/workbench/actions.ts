import * as vscode from "vscode";
import type { WorkbenchIntent } from "./panel.js";
import { workbenchCommands } from "./protocol.js";

/**
 * Carries out what the workbench page asks for, through the same commands as
 * the palette, so confirmations and refreshes stay in one place.
 */
export async function handleIntent(intent: WorkbenchIntent): Promise<void> {
  switch (intent.type) {
    case "command":
      await vscode.commands.executeCommand(workbenchCommands[intent.command]);
      break;
    default:
      // Handled by the tabs that add them.
      break;
  }
}
