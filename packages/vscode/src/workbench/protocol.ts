import type { FileDiff } from "@specflow/core";
import { z } from "zod";
import { workbenchTabs, type WorkbenchTab } from "./html.js";

// What the extension shows the page: plain JSON, built by state.ts and
// imported (types only) by the page.

/** The latest run. */
export type RunView = { target: string; status: "starting" | "running" | "cancelling" | "done" | "failed" | "cancelled" };

export type RequirementView = { id: string; title: string; status: string; priority?: string; line: number };
export type TaskView = {
  id: string;
  title: string;
  status: "todo" | "doing" | "done" | "blocked";
  reqs: string[];
  depends: string[];
  /** Dependencies, as written in `depends:`, that are not done yet (workbench-ui/R3). */
  waitingOn: string[];
  line: number;
};
export type FeatureView = { name: string; requirements: RequirementView[]; tasks: TaskView[] };

export type DriftView = {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  feature: string;
  id?: string;
  line: number;
  file?: string;
  commit?: string;
  subject?: string;
};

export type RootView = {
  root: string;
  name: string;
  /** Why the specs failed to load; `features` is then empty rather than stale (workbench-ui/R2). */
  error?: string;
  features: FeatureView[];
  lintProblems: number;
  /** Drift is only known after a check; until then the workbench says "not checked". */
  drift: { checked: false } | { checked: true; findings: DriftView[] };
  /** Why trace or drift data could not be read. */
  historyError?: string;
};

export type HarnessView =
  | { state: "unknown" }
  | { state: "ready"; name: string; version?: string; warnings: string[] }
  | { state: "problem"; name?: string; message: string; installUrl?: string };

export type ReviewView = {
  root: string;
  target: string;
  files: { path: string; change: "added" | "modified" | "deleted"; outOfScope: boolean }[];
  specNotes: string[];
};

/** A commit that implements a traced item: newest first, with the files it touched. */
export type CommitView = { hash: string; date: string; subject: string; files: { status: string; path: string; from?: string }[] };

/** The requirement or task the Trace tab shows (workbench-ui/R5), or why it cannot be traced. */
export type TraceView =
  | {
      root: string;
      ref: string;
      kind: "requirement" | "task";
      title: string;
      status: string;
      tasks: { feature: string; id: string; title: string; status: TaskView["status"] }[];
      commits: CommitView[];
    }
  | { root: string; ref: string; error: string };

/**
 * The plain-JSON snapshot posted to the workbench page (workbench-ui/R1).
 * `revision` grows with every snapshot, so the page knows when cached diffs
 * may be stale.
 */
export type WorkbenchState = {
  revision: number;
  roots: RootView[];
  harness: HarnessView;
  run?: RunView;
  review?: ReviewView;
  trace?: TraceView;
  /** A drift check is running (workbench-ui/R6). */
  driftChecking?: true;
};

/** What a diff request names; the answer repeats it, so the page can match the two. */
export type DiffRequest = { source: "review" | "working" | "commit"; root: string; path?: string; commit?: string };

/** The extension's answer to a diff request, for the state revision the page had when it asked. */
export type DiffAnswer = DiffRequest & { revision: number } & ({ files: FileDiff[]; truncated: boolean } | { error: string });

/** The cache key of a diff request. */
export function diffKey(request: DiffRequest): string {
  return JSON.stringify([request.source, request.root, request.path ?? null, request.commit ?? null]);
}

/** Messages the extension posts to the workbench page. */
export type HostMessage = { type: "state"; state: WorkbenchState } | { type: "show"; tab: WorkbenchTab } | ({ type: "diff" } & DiffAnswer);

/** Commands the page may run, by the name it uses: no others, and never with arguments. */
export const workbenchCommands = {
  checkDrift: "specflow.checkDrift",
  checkHarness: "specflow.checkHarness",
  showProblems: "workbench.actions.view.problems",
  acceptRun: "specflow.acceptRun",
  discardRun: "specflow.discardRun",
  refresh: "specflow.refresh",
} as const;
export type WorkbenchCommand = keyof typeof workbenchCommands;

const commandNames = Object.keys(workbenchCommands) as [WorkbenchCommand, ...WorkbenchCommand[]];

const name = z.string().min(1).max(200);

/** Raw shapes of what the page may post; anything else is dropped. */
const pageMessage = z.discriminatedUnion("type", [
  // The page has loaded (or reloaded after being hidden) and wants the current state.
  z.object({ type: z.literal("ready") }),
  // The page now shows this tab.
  z.object({ type: z.literal("tab"), tab: z.enum(workbenchTabs) }),
  // The page rendered this state.
  z.object({ type: z.literal("rendered"), revision: z.number().int().nonnegative() }),
  // Intents, handled by the tabs' actions.
  z.object({ type: z.literal("command"), command: z.enum(commandNames) }),
  z.object({ type: z.literal("run"), root: name, feature: name, task: name }),
  z.object({ type: z.literal("open"), root: name, feature: name, id: name }),
  z.object({ type: z.literal("trace"), root: name, ref: name }),
  z.object({ type: z.literal("ack"), root: name, feature: name, id: name, commit: z.string().regex(/^[0-9a-f]{7,64}$/).optional() }),
  z.object({ type: z.literal("openDiff"), path: z.string().min(1).max(4096) }),
  z.object({
    type: z.literal("diff"),
    source: z.enum(["review", "working", "commit"]),
    root: name,
    path: z.string().min(1).max(4096).optional(),
    commit: z.string().regex(/^[0-9a-f]{7,64}$/).optional(),
    revision: z.number().int().nonnegative(),
  }),
]);

/** A message from the page that passed validation against the current state. */
export type PageMessage = z.infer<typeof pageMessage>;

/**
 * Parses a message from the workbench page (workbench-ui/R1). The page is
 * untrusted input: malformed messages are dropped, and so are messages naming
 * a root, feature, task, file or commit the current state does not show, so
 * a compromised page cannot open, run or diff anything the user cannot see.
 */
export function parsePageMessage(raw: unknown, state: WorkbenchState | undefined): PageMessage | undefined {
  const parsed = pageMessage.safeParse(raw);
  if (!parsed.success) return undefined;
  const message = parsed.data;
  switch (message.type) {
    case "ready":
    case "tab":
    case "rendered":
      return message;
    case "command":
      // Accept and discard only mean something while a run is under review.
      return (message.command === "acceptRun" || message.command === "discardRun") && !state?.review ? undefined : message;
    case "run": {
      const task = findFeature(state, message.root, message.feature)?.tasks.find((t) => t.id === message.task);
      return task ? message : undefined;
    }
    case "open": {
      const feature = findFeature(state, message.root, message.feature);
      const known = feature && [...feature.requirements, ...feature.tasks].some((item) => item.id === message.id);
      return known ? message : undefined;
    }
    case "trace": {
      // A requirement or task of a feature the state shows, as `feature/ID`.
      const slash = message.ref.lastIndexOf("/");
      const feature = slash > 0 ? findFeature(state, message.root, message.ref.slice(0, slash)) : undefined;
      const id = message.ref.slice(slash + 1);
      return feature && [...feature.requirements, ...feature.tasks].some((item) => item.id === id) ? message : undefined;
    }
    case "ack": {
      // Only a finding the state shows, with its own commit (or none, for a finding that has none).
      const root = state?.roots.find((r) => r.root === message.root);
      const shown =
        root?.drift.checked &&
        root.drift.findings.some((f) => f.feature === message.feature && f.id === message.id && f.commit === message.commit);
      return shown ? message : undefined;
    }
    case "openDiff":
      return state?.review?.files.some((f) => f.path === message.path) ? message : undefined;
    case "diff":
      return diffAllowed(state, message) ? message : undefined;
  }
}

function findFeature(state: WorkbenchState | undefined, root: string, feature: string) {
  return state?.roots.find((r) => r.root === root)?.features.find((f) => f.name === feature);
}

function diffAllowed(state: WorkbenchState | undefined, message: Extract<PageMessage, { type: "diff" }>): boolean {
  const root = state?.roots.find((r) => r.root === message.root);
  if (!root) return false;
  switch (message.source) {
    case "review":
      // A review diff covers the run's files: all of them, or one of them.
      return (
        state!.review?.root === message.root &&
        message.commit === undefined &&
        (message.path === undefined || state!.review.files.some((f) => f.path === message.path))
      );
    case "working":
      // The whole working tree, read only; single files come from its own answer.
      return message.path === undefined && message.commit === undefined;
    case "commit":
      return message.commit !== undefined && message.path === undefined && knownCommits(state!, root).has(message.commit);
  }
}

// Commits the page shows for a root: drift evidence and the traced item's commits.
function knownCommits(state: WorkbenchState, root: WorkbenchState["roots"][number]): Set<string> {
  const commits = new Set<string>();
  if (root.drift.checked) for (const finding of root.drift.findings) if (finding.commit) commits.add(finding.commit);
  if (state.trace?.root === root.root && "commits" in state.trace) for (const commit of state.trace.commits) commits.add(commit.hash);
  return commits;
}
