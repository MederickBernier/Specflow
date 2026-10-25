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
    case "run":
      // The same command as the explorer's ▶, with the root, so confirmation and checks match (workbench-ui/R3).
      await vscode.commands.executeCommand("specflow.runTask", { ref: { root: intent.root, feature: intent.feature, id: intent.task } });
      break;
    case "open":
      await vscode.commands.executeCommand("specflow.show", `${intent.feature}/${intent.id}`);
      break;
    default:
      // Handled by the tabs that add them.
      break;
  }
}
