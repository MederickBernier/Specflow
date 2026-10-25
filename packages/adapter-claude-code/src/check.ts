import { err, type HarnessCheck, type HarnessCheckError, ok, type Result, type Spawner } from "@specflow/core";

/** Where users are sent when Claude Code is missing or signed out. */
export const installUrl = "https://code.claude.com/docs/en/setup";

/** Claude Code versions the adapter was tested against (docs/spikes/claude-code-headless.md). */
export const testedRange = { min: [2, 1, 0], below: [3, 0, 0] } as const;

const windowsHint =
  " On Windows, an npm install provides claude.cmd, which cannot be started without a shell; install the native claude.exe instead.";

/** Runs `claude --version` and `claude auth status --json` to see whether the harness can run. */
export async function checkClaudeCode(
  spawner: Spawner,
  options: { binary: string; cwd: string; platform: string },
): Promise<Result<HarnessCheck, HarnessCheckError>> {
  const version = await capture(spawner, options.binary, ["--version"], options.cwd);
  if (version.error) {
    const missing = version.error === "ENOENT";
    return err({
      kind: missing ? "not-installed" : "failed",
      message: missing
        ? `Claude Code (${options.binary}) was not found on PATH.${options.platform === "win32" ? windowsHint : ""}`
        : `Could not run ${options.binary} --version: ${version.error}`,
      installUrl,
    });
  }
  if (version.code !== 0) {
    return err({ kind: "failed", message: `${options.binary} --version exited with code ${version.code}`, installUrl });
  }

  const warnings: string[] = [];
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.stdout.trim());
  const found = match ? match.slice(1, 4).map(Number) : undefined;
  if (!found) {
    warnings.push(`Could not read the Claude Code version from "${version.stdout.trim()}"`);
  } else if (compare(found, testedRange.min) < 0 || compare(found, testedRange.below) >= 0) {
    warnings.push(
      `Claude Code ${found.join(".")} is outside the tested range ${testedRange.min.join(".")} to below ${testedRange.below.join(".")}`,
    );
  }

  // Only `loggedIn` is read; the output also holds the account's email and org, which are never kept.
  const auth = await capture(spawner, options.binary, ["auth", "status", "--json"], options.cwd);
  let loggedIn: boolean | undefined;
  try {
    const parsed: unknown = JSON.parse(auth.stdout);
    if (typeof parsed === "object" && parsed !== null && "loggedIn" in parsed) loggedIn = parsed.loggedIn === true;
  } catch {
    // Older versions have no auth status; leave it to the run to fail.
  }
  if (loggedIn === false) {
    return err({ kind: "not-authenticated", message: "Claude Code is not signed in. Run `claude auth login`.", installUrl });
  }
  if (loggedIn === undefined) warnings.push("Could not tell whether Claude Code is signed in");

  return ok({ version: found ? found.join(".") : version.stdout.trim(), warnings });
}

async function capture(
  spawner: Spawner,
  binary: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; code: number | null; error?: string }> {
  const process = spawner.spawn(binary, args, { cwd });
  const lines: string[] = [];
  for await (const line of process.stdout) lines.push(line);
  for await (const _line of process.stderr) {
    // Drained so the process can exit; not used.
  }
  const exit = await process.exit;
  return {
    stdout: lines.join("\n"),
    code: exit.code,
    ...(exit.error && { error: exit.error.code ?? exit.error.message }),
  };
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return 0;
}
