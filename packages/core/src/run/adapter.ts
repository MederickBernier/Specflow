import type { Config } from "../model.js";
import { err, ok, type Result } from "../result.js";
import type { RunEvent } from "./events.js";

/** What an adapter needs to run one task. */
export type RunInput = { cwd: string; prompt: string; extraArgs: string[] };

/** A harness that is usable. `warnings` holds non-fatal problems, such as an untested version. */
export type HarnessCheck = { version: string; warnings: string[] };

/** Why a harness cannot be used. `installUrl` points at its install docs, for a button in the editor. */
export type HarnessCheckError = {
  kind: "not-installed" | "not-authenticated" | "failed";
  message: string;
  installUrl?: string;
};

/**
 * Runs tasks through one agent harness and translates its output into
 * {@link RunEvent}s. Nothing outside an adapter knows harness flags or formats.
 */
export interface HarnessAdapter {
  readonly name: string;
  /** Whether the harness is installed and logged in. */
  check(): Promise<Result<HarnessCheck, HarnessCheckError>>;
  /** Streams the run's events: one `started` first, one `finished` last. Aborting `signal` cancels the run. */
  run(input: RunInput, signal: AbortSignal): AsyncIterable<RunEvent>;
}

/** No adapter is registered under the requested name. */
export type UnknownAdapterError = { kind: "unknown-adapter"; name: string; known: string[]; message: string };

/** Adapters by name. Shells register the adapters they ship; the runner looks them up. */
export class AdapterRegistry {
  readonly #adapters = new Map<string, HarnessAdapter>();

  /** Creates a registry holding `adapters`. */
  constructor(adapters: HarnessAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  /** Adds an adapter. Registering a name twice is a programmer error and throws. */
  register(adapter: HarnessAdapter): void {
    if (this.#adapters.has(adapter.name)) {
      throw new Error(`An adapter named ${adapter.name} is already registered`);
    }
    this.#adapters.set(adapter.name, adapter);
  }

  /** Registered names, sorted. */
  names(): string[] {
    return [...this.#adapters.keys()].sort();
  }

  /** The adapter registered as `name`, or an error listing the registered names. */
  get(name: string): Result<HarnessAdapter, UnknownAdapterError> {
    const adapter = this.#adapters.get(name);
    if (adapter) return ok(adapter);
    const known = this.names();
    return err({
      kind: "unknown-adapter",
      name,
      known,
      message: `Unknown harness "${name}". Registered: ${known.length > 0 ? known.join(", ") : "none"}`,
    });
  }

  /**
   * The adapter to use for a run: `override` (from `--harness` or an editor
   * setting) when given, otherwise `harness.default` from config.
   */
  resolve(config: Config, override?: string): Result<HarnessAdapter, UnknownAdapterError> {
    return this.get(override || config.harness.default);
  }
}
