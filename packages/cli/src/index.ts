#!/usr/bin/env node
import { NodeFileSystem } from "@specflow/core/node";
import { run } from "./program.js";

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  fs: new NodeFileSystem(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
