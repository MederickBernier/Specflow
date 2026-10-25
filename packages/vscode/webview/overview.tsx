import type { FeatureView, RootView, TaskView, WorkbenchCommand, WorkbenchState } from "../src/workbench/protocol.ts";

/** A feature, as the Board's filter names it. */
export type FeatureRef = { root: string; feature: string };

const taskStatuses: { status: TaskView["status"]; icon: string }[] = [
  { status: "todo", icon: "circle-large-outline" },
  { status: "doing", icon: "sync" },
  { status: "done", icon: "pass" },
  { status: "blocked", icon: "circle-slash" },
];
const requirementStatuses = ["approved", "draft", "removed"];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The Overview tab (workbench-ui/R2): lint, drift and harness health at the
 * top, then one card per feature with its requirements and tasks counted by
 * status and its share of tasks done. A card opens the Board on that feature.
 */
export function Overview({
  state,
  onOpenFeature,
  onCommand,
}: {
  state: WorkbenchState;
  onOpenFeature: (ref: FeatureRef) => void;
  onCommand: (command: WorkbenchCommand) => void;
}) {
  const several = state.roots.length > 1;
  return (
    <div class="overview">
      <div class="stats">
        <LintStat roots={state.roots} onCommand={onCommand} />
        <DriftStat roots={state.roots} onCommand={onCommand} />
        <HarnessStat harness={state.harness} onCommand={onCommand} />
      </div>
      {state.roots.length === 0 && <p class="empty">No specs in this workspace.</p>}
      {state.roots.map((root) => (
        <section key={root.root} class="root" aria-label={several ? root.name : "Features"}>
          {several && <h2>{root.name}</h2>}
          <RootFeatures root={root} onOpenFeature={onOpenFeature} />
        </section>
      ))}
    </div>
  );
}

function RootFeatures({ root, onOpenFeature }: { root: RootView; onOpenFeature: (ref: FeatureRef) => void }) {
  if (root.error) {
    return (
      <div class="load-error" role="alert">
        <span class="codicon codicon-error" aria-hidden="true" /> Specs could not be loaded: {root.error}
      </div>
    );
  }
  if (root.features.length === 0) return <p class="empty">No features yet.</p>;
  const drift = root.drift.checked ? root.drift.findings : undefined;
  return (
    <ul class="feature-grid">
      {root.features.map((feature) => (
        <li key={feature.name}>
          <FeatureCard
            feature={feature}
            {...(drift && { driftFindings: drift.filter((f) => f.feature === feature.name).length })}
            onOpen={() => onOpenFeature({ root: root.root, feature: feature.name })}
          />
        </li>
      ))}
    </ul>
  );
}

function FeatureCard({ feature, driftFindings, onOpen }: { feature: FeatureView; driftFindings?: number; onOpen: () => void }) {
  const total = feature.tasks.length;
  const done = feature.tasks.filter((t) => t.status === "done").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const requirements = requirementStatuses
    .map((status) => [status, feature.requirements.filter((r) => r.status === status).length] as const)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n} ${status}`);
  return (
    <button type="button" class="feature-card" onClick={onOpen} aria-label={`${feature.name}: ${done} of ${total} tasks done. Open on the board.`}>
      <span class="feature-name">{feature.name}</span>
      {total === 0 ? (
        <span class="muted">No tasks yet</span>
      ) : (
        <>
          <progress max={total} value={done} aria-hidden="true" />
          <span class="progress-label">
            {done} of {plural(total, "task")} done · {percent}%
          </span>
        </>
      )}
      <span class="counts" data-kind="requirements">
        {feature.requirements.length === 0 ? "No requirements" : `${plural(feature.requirements.length, "requirement")}: ${requirements.join(" · ")}`}
      </span>
      {total > 0 && (
        <span class="counts" data-kind="tasks">
          {taskStatuses.map(({ status, icon }) => {
            const n = feature.tasks.filter((t) => t.status === status).length;
            return n === 0 ? null : (
              <span key={status} class={`count ${status}`} title={status}>
                <span class={`codicon codicon-${icon}`} aria-hidden="true" /> {n} {status}
              </span>
            );
          })}
        </span>
      )}
      {driftFindings !== undefined && driftFindings > 0 && (
        <span class="drift-count">
          <span class="codicon codicon-warning" aria-hidden="true" /> {plural(driftFindings, "drift finding")}
        </span>
      )}
    </button>
  );
}

function Stat({ icon, label, value, tone, action }: { icon: string; label: string; value: string; tone?: "ok" | "warn" | "error"; action?: { title: string; run: () => void } }) {
  return (
    <div class={`stat${tone ? ` ${tone}` : ""}`}>
      <span class={`codicon codicon-${icon}`} aria-hidden="true" />
      <span class="stat-text">
        <span class="stat-label">{label}</span>
        <span class="stat-value">{value}</span>
      </span>
      {action && (
        <button type="button" class="secondary" onClick={action.run}>
          {action.title}
        </button>
      )}
    </div>
  );
}

function LintStat({ roots, onCommand }: { roots: RootView[]; onCommand: (command: WorkbenchCommand) => void }) {
  const problems = roots.reduce((n, r) => n + r.lintProblems + (r.error ? 1 : 0), 0);
  return (
    <Stat
      icon={problems === 0 ? "pass" : "error"}
      label="Lint"
      value={problems === 0 ? "No problems" : plural(problems, "problem")}
      tone={problems === 0 ? "ok" : "error"}
      {...(problems > 0 && { action: { title: "Show problems", run: () => onCommand("showProblems") } })}
    />
  );
}

function DriftStat({ roots, onCommand }: { roots: RootView[]; onCommand: (command: WorkbenchCommand) => void }) {
  const loaded = roots.filter((r) => !r.error);
  const checked = loaded.length > 0 && loaded.every((r) => r.drift.checked);
  const findings = loaded.reduce((n, r) => n + (r.drift.checked ? r.drift.findings.length : 0), 0);
  return (
    <Stat
      icon={!checked ? "question" : findings === 0 ? "pass" : "warning"}
      label="Drift"
      value={!checked ? "Not checked" : findings === 0 ? "No drift" : plural(findings, "finding")}
      {...(checked && { tone: findings === 0 ? ("ok" as const) : ("warn" as const) })}
      action={{ title: "Check drift", run: () => onCommand("checkDrift") }}
    />
  );
}

function HarnessStat({ harness, onCommand }: { harness: WorkbenchState["harness"]; onCommand: (command: WorkbenchCommand) => void }) {
  const action = { title: "Check harness", run: () => onCommand("checkHarness") };
  if (harness.state === "unknown") return <Stat icon="question" label="Harness" value="Not checked" action={action} />;
  if (harness.state === "problem") return <Stat icon="error" label="Harness" value={harness.message} tone="error" action={action} />;
  const value = [harness.name, harness.version].filter(Boolean).join(" ") + (harness.warnings.length > 0 ? ` · ${harness.warnings.join("; ")}` : " · ready");
  return <Stat icon={harness.warnings.length > 0 ? "warning" : "pass"} label="Harness" value={value} tone={harness.warnings.length > 0 ? "warn" : "ok"} action={action} />;
}
