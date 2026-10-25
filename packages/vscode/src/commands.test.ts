import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// commands.ts imports vscode, which only exists inside VS Code; read the table as text instead.
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const parity: Record<string, string> = Object.fromEntries(
  [...readFileSync(here("./commands.ts"), "utf8").matchAll(/^\s+"?([a-z ]+)"?: "(specflow\.[A-Za-z]+)",$/gm)].map((m) => [m[1], m[2]]),
);
const manifest = JSON.parse(readFileSync(here("../package.json"), "utf8")) as {
  contributes: { commands: { command: string; title: string }[]; menus: { commandPalette: { command: string; when?: string }[] } };
};

/**
 * CLI commands, read from the CLI's commander setup: `program.command("x")`
 * at the top, and `x.command("y")` as `x y`. `harness` only groups
 * subcommands, so it is not a command of its own.
 */
function cliCommands(): string[] {
  const source = readFileSync(here("../../cli/src/program.ts"), "utf8");
  const top = [...source.matchAll(/program\s*\.command\("([a-z]+)"\)/g)].map((m) => m[1]!);
  const subs = [...source.matchAll(/^\s*([a-z]+)\s*\.command\("([a-z]+)"\)/gm)].filter((m) => m[1] !== "program").map((m) => `${m[1]} ${m[2]}`);
  const groups = new Set(["harness"]);
  return [...top.filter((name) => !groups.has(name)), ...subs];
}

describe("command palette parity", () => {
  // vscode-extension/R9: every CLI command has a palette entry.
  it("maps every CLI command", () => {
    expect(cliCommands().sort()).toEqual(Object.keys(parity).sort());
  });

  it("contributes every mapped command and shows it in the palette", () => {
    const contributed = new Set(manifest.contributes.commands.map((c) => c.command));
    const hidden = new Set(manifest.contributes.menus.commandPalette.filter((m) => m.when === "false").map((m) => m.command));
    for (const [cli, command] of Object.entries(parity)) {
      expect(contributed.has(command), `${cli} -> ${command} contributed`).toBe(true);
      expect(hidden.has(command), `${command} visible in the palette`).toBe(false);
    }
  });
});
