import { type Feature, type Finding, lint, resolveRef, type SpecTree, type Task, trace } from "@specflow/core";
import type { RootInsights } from "../insights.js";
import type { DriftView, HarnessView, ReviewView, RootView, RunView, TraceView, WorkbenchState } from "./protocol.js";

/** One spec root as the workbench is given it: its tree or load error, and its trace and drift data. */
export type RootInput = { root: string; name: string; tree?: SpecTree; error?: string; insights?: RootInsights };

/** The last harness check, as `checkHarness` reports it. */
export type HarnessInput = { ready: boolean; harness?: string; version?: string; warnings?: string[]; message?: string; installUrl?: string };

/** The latest run. */
export type RunInput = RunView;

/** The staged run waiting for accept or discard. */
export type ReviewInput = {
  root: string;
  target: string;
  files: { path: string; change: "added" | "modified" | "deleted" }[];
  outOfScope: string[];
  specNotes: string[];
};

/** The requirement or task picked for the Trace tab, as `feature/ID` in a root. */
export type TraceInput = { root: string; ref: string };

/** Everything the workbench shows, gathered by the extension. */
export type WorkbenchInputs = { roots: RootInput[]; harness?: HarnessInput; run?: RunInput; review?: ReviewInput; trace?: TraceInput };

/** Builds the workbench state from what the extension knows, without the VS Code API. */
export function buildWorkbenchState(inputs: WorkbenchInputs, revision: number): WorkbenchState {
  return {
    revision,
    roots: inputs.roots.map(rootView),
    harness: harnessView(inputs.harness),
    ...(inputs.run && { run: { target: inputs.run.target, status: inputs.run.status } }),
    ...(inputs.review && { review: reviewView(inputs.review) }),
    ...(inputs.trace && { trace: traceView(inputs.roots, inputs.trace) }),
  };
}

// workbench-ui/R5: the traced item's tasks and commits, through core's trace over the root's trace commits.
function traceView(roots: RootInput[], target: TraceInput): TraceView {
  const root = roots.find((r) => r.root === target.root);
  if (!root?.tree || root.error) return { ...target, error: root?.error ?? "Specs not loaded" };
  const result = trace(root.tree, root.insights?.commits ?? [], target.ref);
  if (!result.ok) return { ...target, error: result.error.message };
  const traced = result.value;
  if (traced.kind === "feature") return { ...target, error: "Pick a requirement or a task" };
  const commits = traced.trace.commits.map((c) => ({
    hash: c.hash,
    date: c.date,
    subject: c.subject,
    files: c.files.map((f) => ({ status: f.status, path: f.path, ...(f.from && { from: f.from }) })),
  }));
  if (traced.kind === "task") {
    const { feature, id, title, status } = traced.trace;
    return { ...target, kind: "task", title, status, tasks: [{ feature, id, title, status }], commits };
  }
  const requirement = root.tree.features.find((f) => f.name === traced.trace.feature)?.requirements.find((r) => r.id === traced.trace.id);
  return { ...target, kind: "requirement", title: traced.trace.title, status: requirement?.status ?? "approved", tasks: traced.trace.tasks, commits };
}

function rootView(input: RootInput): RootView {
  const base = { root: input.root, name: input.name, ...(input.insights?.error && { historyError: input.insights.error }) };
  // A failed reload keeps the last good tree in SpecService; the workbench shows the error instead.
  if (input.error || !input.tree) {
    return { ...base, error: input.error ?? "Specs not loaded", features: [], lintProblems: 0, drift: { checked: false } };
  }
  const drift = input.insights?.drift;
  return {
    ...base,
    features: input.tree.features.map((feature) => ({
      name: feature.name,
      requirements: feature.requirements.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        ...(r.priority && { priority: r.priority }),
        line: r.location.startLine,
      })),
      tasks: feature.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        reqs: t.reqs,
        depends: t.depends,
        waitingOn: waitingOn(input.tree!, feature, t),
        line: t.location.startLine,
      })),
    })),
    lintProblems: lint(input.tree).length,
    drift: drift ? { checked: true, findings: drift.map(driftView) } : { checked: false },
  };
}

// Dependencies that exist and are not done. Unknown ones are lint's to report.
function waitingOn(tree: SpecTree, feature: Feature, task: Task): string[] {
  return task.depends.filter((dep) => {
    const ref = resolveRef(dep, feature.name);
    const found = tree.features.find((f) => f.name === ref.feature)?.tasks.find((t) => t.id === ref.id);
    return found !== undefined && found.status !== "done";
  });
}

function driftView(finding: Finding): DriftView {
  return {
    rule: finding.rule,
    severity: finding.severity,
    message: finding.message,
    feature: finding.feature,
    ...(finding.id && { id: finding.id }),
    line: finding.location.startLine,
    ...(finding.evidence?.file && { file: finding.evidence.file }),
    ...(finding.evidence?.commit && { commit: finding.evidence.commit }),
    ...(finding.evidence?.subject && { subject: finding.evidence.subject }),
  };
}

function harnessView(input: HarnessInput | undefined): HarnessView {
  if (!input) return { state: "unknown" };
  if (input.ready) {
    return { state: "ready", name: input.harness ?? "harness", ...(input.version && { version: input.version }), warnings: input.warnings ?? [] };
  }
  return {
    state: "problem",
    ...(input.harness && { name: input.harness }),
    message: input.message ?? "The harness cannot run tasks.",
    ...(input.installUrl && { installUrl: input.installUrl }),
  };
}

function reviewView(input: ReviewInput): ReviewView {
  const outside = new Set(input.outOfScope);
  return {
    root: input.root,
    target: input.target,
    files: input.files.map((f) => ({ ...f, outOfScope: outside.has(f.path) })),
    specNotes: input.specNotes,
  };
}
