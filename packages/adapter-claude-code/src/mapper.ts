import { type RunEvent, toPosixPath } from "@specflow/core";

// Translates Claude Code `--output-format stream-json` lines into RunEvents.
// Field names and the mapping come from docs/spikes/claude-code-headless.md.

type ToolUse = { name: string; input: Record<string, unknown> };

/** The parts of the final `result` line the adapter needs after the process exits. */
export type ClaudeResult = { ok: boolean; summary?: string; errors: string[] };

/** Tools whose successful result means a file changed, and what they report. */
const fileTools = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * Stateful mapper for one run. Feed it each parsed stdout line with `map`;
 * it returns the events for that line (often none). `result` holds the final
 * `result` line once seen; the adapter emits `finished` itself, after exit.
 */
export class StreamMapper {
  readonly #cwd: string;
  readonly #harness: string;
  readonly #now: () => Date;
  readonly #tools = new Map<string, ToolUse>();
  readonly #denied = new Set<string>();
  /** Paths already reported in `file-changed`, relative to cwd. */
  readonly reported = new Set<string>();
  /** True once `system/init` was seen and `started` emitted. */
  started = false;
  result: ClaudeResult | undefined;

  constructor(options: { cwd: string; harness: string; now: () => Date }) {
    this.#cwd = toPosixPath(options.cwd);
    this.#harness = options.harness;
    this.#now = options.now;
  }

  /** Events for one stdout line. Lines that are not JSON objects, and unknown types, map to nothing. */
  map(line: unknown): RunEvent[] {
    if (!isObject(line)) return [];
    switch (line.type) {
      case "system":
        return this.#system(line);
      case "assistant":
        return this.#assistant(line);
      case "user":
        return this.#user(line);
      case "result":
        return this.#result(line);
      default:
        return [];
    }
  }

  /** Path relative to cwd with forward slashes, or absolute when outside cwd. */
  relative(path: string): string {
    const posix = toPosixPath(path);
    return posix.startsWith(`${this.#cwd}/`) ? posix.slice(this.#cwd.length + 1) : posix;
  }

  #system(line: Record<string, unknown>): RunEvent[] {
    if (line.subtype === "init" && !this.started) {
      this.started = true;
      return [
        {
          kind: "started",
          runId: typeof line.session_id === "string" ? line.session_id : `claude-${this.#now().getTime()}`,
          harness: this.#harness,
          at: this.#now().toISOString(),
        },
      ];
    }
    if (line.subtype === "permission_denied") {
      const id = String(line.tool_use_id ?? "");
      this.#denied.add(id);
      return [this.#denial(String(line.tool_name ?? "tool"), id, String(line.message ?? "denied"))];
    }
    return [];
  }

  #assistant(line: Record<string, unknown>): RunEvent[] {
    const events: RunEvent[] = [];
    for (const block of content(line)) {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
        events.push({ kind: "message", role: "assistant", text: block.text });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        const input = isObject(block.input) ? block.input : {};
        this.#tools.set(String(block.id ?? ""), { name: block.name, input });
        events.push({ kind: "tool-call", tool: block.name, summary: this.#summary(block.name, input) });
        if (block.name === "Bash" && typeof input.command === "string") {
          events.push({ kind: "command", command: input.command });
        }
      }
    }
    return events;
  }

  #user(line: Record<string, unknown>): RunEvent[] {
    const events: RunEvent[] = [];
    for (const block of content(line)) {
      if (block.type !== "tool_result" || block.is_error === true) continue;
      const tool = this.#tools.get(String(block.tool_use_id ?? ""));
      if (!tool || !fileTools.has(tool.name)) continue;
      const path = filePath(tool.input);
      if (!path) continue;
      const details = isObject(line.tool_use_result) ? line.tool_use_result : {};
      const change = tool.name === "Write" && details.type === "create" ? "added" : "modified";
      const relative = this.relative(path);
      this.reported.add(relative);
      events.push({ kind: "file-changed", path: relative, change });
    }
    return events;
  }

  #result(line: Record<string, unknown>): RunEvent[] {
    const events: RunEvent[] = [];
    // Denials the stream did not already report as system/permission_denied.
    for (const denial of Array.isArray(line.permission_denials) ? line.permission_denials : []) {
      if (!isObject(denial)) continue;
      const id = String(denial.tool_use_id ?? "");
      if (this.#denied.has(id)) continue;
      this.#denied.add(id);
      events.push(this.#denial(String(denial.tool_name ?? "tool"), id, "denied"));
    }

    const usage = isObject(line.usage) ? line.usage : {};
    const tokens = (...keys: string[]) =>
      keys.map((key) => usage[key]).filter((v): v is number => typeof v === "number");
    const input = tokens("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens");
    const output = tokens("output_tokens");
    events.push({
      kind: "usage",
      ...(input.length > 0 && { inputTokens: input.reduce((a, b) => a + b, 0) }),
      ...(output.length > 0 && { outputTokens: output[0] }),
      ...(typeof line.total_cost_usd === "number" && { costUsd: line.total_cost_usd }),
      ...(typeof line.duration_ms === "number" && { durationMs: line.duration_ms }),
    });

    const isError = line.is_error === true;
    const errors = (Array.isArray(line.errors) ? line.errors : []).map(String);
    if (isError && errors.length === 0) errors.push(`Claude Code reported ${String(line.subtype ?? "an error")}`);
    this.result = {
      ok: !isError,
      ...(typeof line.result === "string" && line.result !== "" && { summary: line.result }),
      errors: isError ? errors : [],
    };
    return events;
  }

  #denial(tool: string, id: string, reason: string): RunEvent {
    const use = this.#tools.get(id);
    const what = use ? `${tool} (${this.#summary(use.name, use.input)})` : tool;
    return { kind: "error", message: `Permission denied for ${what}: ${reason}`, fatal: false };
  }

  #summary(tool: string, input: Record<string, unknown>): string {
    const path = filePath(input);
    if (path) return this.relative(path);
    for (const key of ["command", "pattern", "url", "query", "description"]) {
      if (typeof input[key] === "string") return input[key];
    }
    return tool;
  }
}

function filePath(input: Record<string, unknown>): string | undefined {
  const path = input.file_path ?? input.notebook_path ?? input.path;
  return typeof path === "string" ? path : undefined;
}

function content(line: Record<string, unknown>): Record<string, unknown>[] {
  const message = isObject(line.message) ? line.message : {};
  return Array.isArray(message.content) ? message.content.filter(isObject) : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
