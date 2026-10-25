import { err, ok, type Result } from "./result.js";

/** A git command that failed. */
export type GitError = { args: string[]; exitCode: number | null; stderr: string; message: string };

/** Thrown while iterating {@link Git.lines} when git fails, since an iterator cannot return a Result. */
export class GitCommandError extends Error {
  readonly error: GitError;

  constructor(error: GitError) {
    super(error.message);
    this.error = error;
    this.name = "GitCommandError";
  }
}

/**
 * Git, injected into `core`. Deliberately thin: typed helpers such as
 * `status` or `log` are plain functions built on these two calls.
 */
export interface Git {
  /** Runs `git <args>` and returns its whole stdout. A non-zero exit is an error. */
  run(args: string[], options?: { cwd?: string; stdin?: string }): Promise<Result<string, GitError>>;
  /**
   * Runs `git <args>` and yields stdout line by line, for large output such
   * as `git log`. Throws {@link GitCommandError} at the end if git fails.
   * Stopping early ends the git process.
   */
  lines(args: string[], options?: { cwd?: string }): AsyncIterable<string>;
}

/** One recorded {@link Git} call. */
export type GitCall = { args: string[]; cwd?: string; stdin?: string };

/** What a {@link FakeGit} handler returns: stdout, or a failure. */
export type FakeGitResponse = string | { exitCode: number; stderr: string };

/**
 * {@link Git} for tests. `handler` answers each call; `lines` splits the same
 * answer into lines. Every call is recorded in `calls`.
 */
export class FakeGit implements Git {
  readonly calls: GitCall[] = [];
  readonly #handler: (call: GitCall) => FakeGitResponse;

  constructor(handler: (call: GitCall) => FakeGitResponse) {
    this.#handler = handler;
  }

  async run(args: string[], options: { cwd?: string; stdin?: string } = {}): Promise<Result<string, GitError>> {
    const response = this.#answer({ args, ...options });
    return typeof response === "string" ? ok(response) : err(toError(args, response));
  }

  async *lines(args: string[], options: { cwd?: string } = {}): AsyncIterable<string> {
    const response = this.#answer({ args, ...options });
    if (typeof response !== "string") throw new GitCommandError(toError(args, response));
    const lines = response.split("\n");
    if (lines.at(-1) === "") lines.pop();
    yield* lines;
  }

  #answer(call: GitCall): FakeGitResponse {
    this.calls.push(call);
    return this.#handler(call);
  }
}

/** Builds the {@link GitError} for a failed `git <args>`. */
export function gitError(args: string[], exitCode: number | null, stderr: string): GitError {
  const detail = stderr.trim() || (exitCode === null ? "terminated" : `exit code ${exitCode}`);
  return { args, exitCode, stderr, message: `git ${args.join(" ")} failed: ${detail}` };
}

function toError(args: string[], failure: { exitCode: number; stderr: string }): GitError {
  return gitError(args, failure.exitCode, failure.stderr);
}
