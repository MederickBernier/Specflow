import type { RunEvent, RunTaskResult } from "@specflow/core";

/** One rendered line of a run. */
export type RunLine = { kind: "message" | "tool" | "file" | "command" | "warning" | "error"; text: string };

/** Everything the run view shows, built from events without the VS Code API. */
export type RunViewState = {
  title: string;
  harness?: string;
  status: "starting" | "running" | "cancelling" | "done" | "failed" | "cancelled";
  lines: RunLine[];
  usage?: string;
  outcome?: string;
};

const marks = { added: "+", modified: "~", deleted: "-" } as const;

export function initialState(target: string): RunViewState {
  return { title: `Run ${target}`, status: "starting", lines: [] };
}

/** Applies one event (vscode-extension/R4: messages, tool calls, files changed, usage). */
export function reduce(state: RunViewState, event: RunEvent): RunViewState {
  const add = (line: RunLine) => ({ ...state, lines: [...state.lines, line] });
  switch (event.kind) {
    case "started":
      return { ...state, harness: event.harness, status: state.status === "cancelling" ? "cancelling" : "running" };
    case "message":
      return add({ kind: "message", text: event.text.trim() });
    case "tool-call":
      return add({ kind: "tool", text: `${event.tool} ${event.summary}` });
    case "file-changed":
      return add({ kind: "file", text: `${marks[event.change]} ${event.path}` });
    case "command":
      return add({ kind: "command", text: `$ ${event.command}${event.exitCode === undefined ? "" : ` (exit ${event.exitCode})`}` });
    case "error":
      return add({ kind: event.fatal ? "error" : "warning", text: event.message });
    case "usage":
      return { ...state, usage: formatUsage(event) };
    case "finished":
      return { ...state, status: event.cancelled ? "cancelled" : event.ok ? "done" : "failed" };
  }
}

/** Marks a cancel request until the run reports back. */
export function cancelling(state: RunViewState): RunViewState {
  return state.status === "starting" || state.status === "running" ? { ...state, status: "cancelling" } : state;
}

/** Adds what happened after the run: recording, scope warnings and spec notes. */
export function withOutcome(state: RunViewState, result: RunTaskResult): RunViewState {
  const parts: string[] = [];
  const { recording } = result;
  if (result.cancelled) parts.push("Cancelled. The task status was restored; changes made before cancelling are left in place.");
  else if (!result.ok) parts.push("Failed. The task status was restored; changes made during the run are left in place.");
  else if (!recording) parts.push("No files changed, so nothing was recorded and the task status was restored.");
  else if (recording.mode === "staged") parts.push(`Staged ${recording.files.length} files with a prepared commit message, and marked the task done.`);
  else if (recording.mode === "auto") parts.push(`Committed ${recording.commit.slice(0, 7)} with ${recording.files.length} files, and marked the task done.`);
  if (result.scope.outOfScope.length > 0) parts.push(`Changed outside the task's files: ${result.scope.outOfScope.join(", ")}.`);
  if (result.scope.specEdits.length > 0) parts.push(`The harness edited spec files: ${result.scope.specEdits.join(", ")}.`);
  if (result.specNotes.length > 0) parts.push(`Spec notes from the agent (not applied): ${result.specNotes.join(" ")}`);
  return { ...state, outcome: parts.join("\n") };
}

export function formatUsage(event: Extract<RunEvent, { kind: "usage" }>): string | undefined {
  const parts = [
    event.inputTokens !== undefined && `${event.inputTokens.toLocaleString("en-US")} tokens in`,
    event.outputTokens !== undefined && `${event.outputTokens.toLocaleString("en-US")} out`,
    event.costUsd !== undefined && `$${event.costUsd.toFixed(2)}`,
    event.durationMs !== undefined && `${(event.durationMs / 1000).toFixed(1)} s`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/** The view's HTML body. All text is escaped. */
export function renderBody(state: RunViewState): string {
  const running = state.status === "starting" || state.status === "running";
  const lines = state.lines.map((line) => `<li class="${line.kind}">${escape(line.text)}</li>`).join("");
  return [
    `<header><h1>${escape(state.title)}</h1><span class="status ${state.status}">${statusLabel(state)}</span>`,
    running ? `<button data-action="cancel">Cancel</button>` : "",
    "</header>",
    `<ol class="events">${lines}</ol>`,
    state.outcome ? `<p class="outcome">${escape(state.outcome).replaceAll("\n", "<br>")}</p>` : "",
    state.usage ? `<footer>Usage: ${escape(state.usage)}</footer>` : "",
  ].join("");
}

/** The confirmation shown before a run (vscode-extension/R4). */
export function confirmationDetail(target: string, harness: string, mode: "staged" | "auto"): string {
  const commit = mode === "staged" ? "stage the changes for your review" : "commit the changes automatically";
  return `Run ${target} with ${harness}? On success specflow will ${commit}, with spec trailers.`;
}

function statusLabel(state: RunViewState): string {
  const harness = state.harness ? ` with ${escape(state.harness)}` : "";
  return { starting: "Starting", running: `Running${harness}`, cancelling: "Cancelling", done: "Finished", failed: "Failed", cancelled: "Cancelled" }[state.status];
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
