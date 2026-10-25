import type { FileSystem } from "@specflow/core";
import { Command, CommanderError } from "commander";
import { lintCommand } from "./commands/lint.js";
import { showCommand } from "./commands/show.js";

/** Everything a command touches outside itself, injected so tests run in-process. */
export type Io = {
  cwd: string;
  fs: FileSystem;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

/** Exit codes shared by every command. */
export const exitCodes = { ok: 0, failed: 1, unusable: 2 } as const;

/** Parses `argv` (without the node and script entries), runs the command and returns its exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  let code: number = exitCodes.ok;
  const program = new Command("specflow")
    .description("Spec-driven development: specs, tasks and traceability in git")
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr });

  program
    .command("lint")
    .description("Check the spec tree for structural problems; exit code 1 when any error is found")
    .option("--json", "print machine-readable output")
    .action(async (options: { json?: boolean }) => {
      code = await lintCommand(io, { json: options.json ?? false });
    });

  program
    .command("show")
    .description("Show a feature, requirement or task")
    .argument("<target>", "feature, or feature/ID such as auth/R3")
    .option("--json", "print machine-readable output")
    .action(async (target: string, options: { json?: boolean }) => {
      code = await showCommand(io, target, { json: options.json ?? false });
    });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? exitCodes.ok : exitCodes.unusable;
    }
    throw error;
  }
  return code;
}
