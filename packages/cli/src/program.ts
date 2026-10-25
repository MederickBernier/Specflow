import type { AdapterRegistry, Clock, FileSystem, Git } from "@specflow/core";
import { Command, CommanderError, Option } from "commander";
import { driftAckCommand, driftCommand } from "./commands/drift.js";
import { harnessCheckCommand } from "./commands/harness.js";
import { initCommand } from "./commands/init.js";
import { lintCommand } from "./commands/lint.js";
import { runCommand } from "./commands/run.js";
import { showCommand } from "./commands/show.js";
import { traceCommand } from "./commands/trace.js";

/** Everything a command touches outside itself, injected so tests run in-process. */
export type Io = {
  cwd: string;
  fs: FileSystem;
  git: Git;
  registry: AdapterRegistry;
  clock: Clock;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Calls `handler` on Ctrl+C until the returned function is called. */
  onInterrupt: (handler: () => void) => () => void;
};

/** Exit codes shared by every command. `cancelled` follows the shell convention for Ctrl+C. */
export const exitCodes = { ok: 0, failed: 1, unusable: 2, cancelled: 130 } as const;

/** Parses `argv` (without the node and script entries), runs the command and returns its exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  let code: number = exitCodes.ok;
  const program = new Command("specflow")
    .description("Spec-driven development: specs, tasks and traceability in git")
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    // Options belong to the command they follow, so `drift --json` and `drift ack --json` stay apart.
    .enablePositionalOptions();

  program
    .command("init")
    .description("Create .specs/ with steering templates, config.yml and an example feature")
    .option("--force", "add missing template files to an existing .specs/; never overwrites")
    .option("--json", "print machine-readable output")
    .action(async (options: { force?: boolean; json?: boolean }) => {
      code = await initCommand(io, { force: options.force ?? false, json: options.json ?? false });
    });

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

  program
    .command("run")
    .description("Run one task through the agent harness and record the result in git")
    .argument("<task>", "feature/task, such as auth/T3")
    .option("--harness <name>", "adapter to use instead of harness.default")
    .option("--allow-dirty", "run even with uncommitted changes outside the specs folder")
    .option("--json", "print one JSON object per line")
    .action(async (target: string, options: { harness?: string; allowDirty?: boolean; json?: boolean }) => {
      code = await runCommand(io, target, {
        ...(options.harness !== undefined && { harness: options.harness }),
        allowDirty: options.allowDirty ?? false,
        json: options.json ?? false,
      });
    });

  program
    .command("trace")
    .description("List the tasks and commits that implement a feature, requirement or task")
    .argument("<target>", "feature, or feature/ID such as auth/R3")
    .option("--json", "print machine-readable output")
    .action(async (target: string, options: { json?: boolean }) => {
      code = await traceCommand(io, target, { json: options.json ?? false });
    });

  const drift = program
    .command("drift")
    .description("Find requirements whose code and spec no longer agree")
    .argument("[target]", "feature, or feature/ID such as auth/R3")
    .option("--json", "print machine-readable output")
    .option("--llm", "also ask the harness whether each finding's code still meets its criteria")
    .addOption(new Option("--fail-on <severity>", "exit 1 when a finding is at least this severe").choices(["warning", "error"]))
    .action(async (target: string | undefined, options: { json?: boolean; llm?: boolean; failOn?: "warning" | "error" }) => {
      code = await driftCommand(io, target, {
        json: options.json ?? false,
        llm: options.llm ?? false,
        ...(options.failOn !== undefined && { failOn: options.failOn }),
      });
    });

  drift.enablePositionalOptions();
  drift
    .command("ack")
    .description("Acknowledge drift on a requirement up to a commit, writing its drift-ack: line")
    .argument("<requirement>", "feature/R<n>, such as auth/R3")
    .argument("<commit>", "the commit up to which the drift is acknowledged")
    .option("--json", "print machine-readable output")
    .action(async (ref: string, commit: string, options: { json?: boolean }) => {
      code = await driftAckCommand(io, ref, commit, { json: options.json ?? false });
    });

  const harness = program.command("harness").description("Inspect the agent harness");
  harness
    .command("check")
    .description("Check that the harness is installed and signed in")
    .option("--harness <name>", "adapter to check instead of harness.default")
    .option("--json", "print machine-readable output")
    .action(async (options: { harness?: string; json?: boolean }) => {
      code = await harnessCheckCommand(io, {
        ...(options.harness !== undefined && { harness: options.harness }),
        json: options.json ?? false,
      });
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
