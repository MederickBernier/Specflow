import { describe, expect, it } from "vitest";
import { harnessMessage, installButton } from "./harness-message.js";

const ok = <T>(value: T) => ({ ok: true as const, value });
const err = <E>(error: E) => ({ ok: false as const, error });

describe("harnessMessage", () => {
  // vscode-extension/R8: a missing harness explains itself and links to the install docs.
  it("explains a missing harness with the install docs link", () => {
    const message = harnessMessage(
      ok({ name: "claude-code", check: err({ kind: "not-installed" as const, message: "Claude Code (claude) was not found on PATH.", installUrl: "https://code.claude.com/docs/en/setup" }) }),
      { quiet: true },
    );
    expect(message).toEqual({
      level: "warning",
      text: "Specflow can't run tasks: Claude Code (claude) was not found on PATH.",
      installUrl: "https://code.claude.com/docs/en/setup",
    });
    expect(installButton).toBe("Open install docs");
  });

  // vscode-extension/R8: not signed in.
  it("tells a signed-out user to sign in", () => {
    const message = harnessMessage(
      ok({ name: "claude-code", check: err({ kind: "not-authenticated" as const, message: "Claude Code is not signed in. Run `claude auth login`.", installUrl: "https://x" }) }),
      { quiet: true },
    );
    expect(message).toMatchObject({ level: "warning", text: expect.stringContaining("Sign in, then try again."), installUrl: "https://x" });
  });

  it("explains an unknown harness name", () => {
    const message = harnessMessage(err({ kind: "unknown-adapter" as const, name: "aider", known: ["claude-code"], message: 'Unknown harness "aider". Registered: claude-code' }), { quiet: true });
    expect(message).toEqual({ level: "warning", text: 'Specflow: Unknown harness "aider". Registered: claude-code. Set specflow.harness or harness.default in .specs/config.yml.' });
  });

  it("shows version warnings as information", () => {
    expect(harnessMessage(ok({ name: "claude-code", check: ok({ version: "3.0.0", warnings: ["outside the tested range"] }) }), { quiet: true })).toEqual({
      level: "info",
      text: "Specflow: claude-code 3.0.0: outside the tested range",
    });
  });

  it("stays quiet when all is well, unless asked", () => {
    const ready = ok({ name: "claude-code", check: ok({ version: "2.1.310", warnings: [] }) });
    expect(harnessMessage(ready, { quiet: true })).toEqual({ level: "none" });
    expect(harnessMessage(ready, { quiet: false })).toEqual({ level: "info", text: "Specflow: claude-code 2.1.310 is ready." });
  });
});
