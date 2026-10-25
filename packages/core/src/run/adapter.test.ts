import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config.js";
import type { Config } from "../model.js";
import { ok } from "../result.js";
import { AdapterRegistry, type HarnessAdapter } from "./adapter.js";

function adapter(name: string): HarnessAdapter {
  return {
    name,
    check: async () => ok({ version: "1.0.0", warnings: [] }),
    run: async function* () {},
  };
}

const config = (harness: string): Config => ({ ...defaultConfig, harness: { default: harness, adapters: {} } });

describe("AdapterRegistry", () => {
  const claude = adapter("claude-code");
  const replay = adapter("replay");
  const registry = new AdapterRegistry([replay, claude]);

  // task-run/R2: config selects the adapter by name.
  it("resolves harness.default from config", () => {
    expect(registry.resolve(config("claude-code"))).toEqual({ ok: true, value: claude });
  });

  it("prefers an explicit override", () => {
    expect(registry.resolve(config("claude-code"), "replay")).toEqual({ ok: true, value: replay });
    expect(registry.resolve(config("replay"), "")).toEqual({ ok: true, value: replay });
  });

  // task-run/R2: an unknown name fails with the registered adapters.
  it("fails on an unknown name, listing the registered adapters", () => {
    expect(registry.resolve(config("aider"))).toEqual({
      ok: false,
      error: {
        kind: "unknown-adapter",
        name: "aider",
        known: ["claude-code", "replay"],
        message: 'Unknown harness "aider". Registered: claude-code, replay',
      },
    });
  });

  it("says when nothing is registered", () => {
    const result = new AdapterRegistry().get("claude-code");
    expect(!result.ok && result.error.message).toBe('Unknown harness "claude-code". Registered: none');
  });

  it("refuses to register a name twice", () => {
    const local = new AdapterRegistry([claude]);
    expect(() => local.register(adapter("claude-code"))).toThrow("already registered");
    expect(local.names()).toEqual(["claude-code"]);
  });
});
