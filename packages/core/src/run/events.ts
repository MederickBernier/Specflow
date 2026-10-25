import { z } from "zod";
import { err, ok, type Result } from "../result.js";

/**
 * What a harness run reports, normalized across harnesses. Adapters emit
 * exactly one `started` first and exactly one `finished` last; `usage` is
 * optional. Harness events with no equivalent are dropped by the adapter.
 */
export type RunEvent =
  | { kind: "started"; runId: string; harness: string; at: string }
  | { kind: "message"; role: "assistant" | "system"; text: string }
  | { kind: "tool-call"; tool: string; summary: string }
  | { kind: "file-changed"; path: string; change: "added" | "modified" | "deleted" }
  | { kind: "command"; command: string; exitCode?: number }
  | { kind: "usage"; inputTokens?: number; outputTokens?: number; costUsd?: number; durationMs?: number }
  | { kind: "error"; message: string; fatal: boolean }
  | { kind: "finished"; ok: boolean; cancelled?: boolean; summary?: string };

/** Every `RunEvent` kind, in the order the design lists them. */
export const runEventKinds = [
  "started",
  "message",
  "tool-call",
  "file-changed",
  "command",
  "usage",
  "error",
  "finished",
] as const satisfies readonly RunEvent["kind"][];

const count = z.number().int().nonnegative();

const runEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("started"), runId: z.string(), harness: z.string(), at: z.string() }),
  z.strictObject({ kind: z.literal("message"), role: z.enum(["assistant", "system"]), text: z.string() }),
  z.strictObject({ kind: z.literal("tool-call"), tool: z.string(), summary: z.string() }),
  z.strictObject({ kind: z.literal("file-changed"), path: z.string(), change: z.enum(["added", "modified", "deleted"]) }),
  z.strictObject({ kind: z.literal("command"), command: z.string(), exitCode: z.number().int().optional() }),
  z.strictObject({
    kind: z.literal("usage"),
    inputTokens: count.optional(),
    outputTokens: count.optional(),
    costUsd: z.number().nonnegative().optional(),
    durationMs: z.number().nonnegative().optional(),
  }),
  z.strictObject({ kind: z.literal("error"), message: z.string(), fatal: z.boolean() }),
  z.strictObject({ kind: z.literal("finished"), ok: z.boolean(), cancelled: z.boolean().optional(), summary: z.string().optional() }),
]);

/** Checks that `value` is a well-formed {@link RunEvent}, for events read from files or other processes. */
export function parseRunEvent(value: unknown): Result<RunEvent, string> {
  const parsed = runEventSchema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  const issue = parsed.error.issues[0]!;
  const key = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return err(`Invalid run event: ${key}${issue.message}`);
}

/**
 * Problems with the order of a complete event stream: it must start with
 * exactly one `started` and end with exactly one `finished`. Empty when the
 * stream is valid. Contract tests for adapters assert on this.
 */
export function eventSequenceProblems(events: readonly RunEvent[]): string[] {
  const problems: string[] = [];
  const started = events.filter((e) => e.kind === "started").length;
  const finished = events.filter((e) => e.kind === "finished").length;
  if (events[0]?.kind !== "started") problems.push("first event is not started");
  if (events.at(-1)?.kind !== "finished") problems.push("last event is not finished");
  if (started > 1) problems.push(`${started} started events, expected 1`);
  if (finished > 1) problems.push(`${finished} finished events, expected 1`);
  return problems;
}
