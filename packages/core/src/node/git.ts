import { spawn } from "node:child_process";
import { type Git, GitCommandError, type GitError, gitError } from "../git.js";
import { err, ok, type Result } from "../result.js";
import { NodeSpawner } from "./spawner.js";

/** {@link Git} over the `git` binary, run without a shell and without prompting. */
export class NodeGit implements Git {
  readonly #cwd: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #spawner: NodeSpawner;

  /** `cwd` is used when a call does not pass one; it defaults to the process's working directory. */
  constructor(options: { cwd?: string } = {}) {
    this.#cwd = options.cwd ?? process.cwd();
    // Never wait on a credential prompt, and keep messages in English for parsing.
    this.#env = { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
    this.#spawner = new NodeSpawner({ env: this.#env });
  }

  run(args: string[], options: { cwd?: string; stdin?: string } = {}): Promise<Result<string, GitError>> {
    return new Promise((resolve) => {
      const child = spawn("git", args, {
        cwd: options.cwd ?? this.#cwd,
        env: this.#env,
        shell: false,
        windowsHide: true,
        stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk));
      if (options.stdin !== undefined && child.stdin) {
        child.stdin.on("error", () => {});
        child.stdin.end(options.stdin);
      }
      let settled = false;
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        resolve(err(gitError(args, null, error.message)));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        const out = Buffer.concat(stdout).toString("utf8");
        resolve(code === 0 ? ok(out) : err(gitError(args, code, Buffer.concat(stderr).toString("utf8"))));
      });
    });
  }

  async *lines(args: string[], options: { cwd?: string } = {}): AsyncIterable<string> {
    const process = this.#spawner.spawn("git", args, { cwd: options.cwd ?? this.#cwd });
    let finished = false;
    try {
      yield* process.stdout;
      finished = true;
    } finally {
      if (!finished) process.kill("SIGTERM");
    }
    const stderr: string[] = [];
    for await (const line of process.stderr) stderr.push(line);
    const exit = await process.exit;
    if (exit.error || exit.code !== 0) {
      throw new GitCommandError(gitError(args, exit.code, exit.error?.message ?? stderr.join("\n")));
    }
  }
}
