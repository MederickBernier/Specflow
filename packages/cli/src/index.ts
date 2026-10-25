#!/usr/bin/env node
import { ClaudeCodeAdapter } from "@specflow/adapter-claude-code";
import { AdapterRegistry } from "@specflow/core";
import { NodeFileSystem, NodeGit, NodeSpawner, SystemClock } from "@specflow/core/node";
import { exitCodes, run } from "./program.js";

const git = new NodeGit();
const clock = new SystemClock();

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  fs: new NodeFileSystem(),
  git,
  registry: new AdapterRegistry([new ClaudeCodeAdapter({ spawner: new NodeSpawner(), git, clock })]),
  clock,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  onInterrupt: (handler) => {
    let presses = 0;
    const listener = () => {
      // First Ctrl+C cancels the run; a second one quits without waiting.
      if (++presses > 1) process.exit(exitCodes.cancelled);
      handler();
    };
    process.on("SIGINT", listener);
    return () => process.off("SIGINT", listener);
  },
});
