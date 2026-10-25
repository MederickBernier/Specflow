import { useState } from "preact/hooks";
import type { DriftView, RootView, WorkbenchState } from "../src/workbench/protocol.ts";
import { type DiffLayout, DiffLayoutSwitch, DiffView } from "./diff-view.tsx";
import type { DiffSource } from "./diffs.ts";

const severityIcons = { error: "error", warning: "warning", info: "info" } as const;

type Props = {
  state: WorkbenchState;
  diffs: DiffSource;
  layout: DiffLayout;
  onLayout: (layout: DiffLayout) => void;
  onCheck: () => void;
  onAck: (root: string, finding: DriftView) => void;
  onOpen: (root: string, feature: string, id: string) => void;
};

/**
 * The Drift tab (workbench-ui/R6): findings grouped by feature and
 * requirement, with rule, message, file and commit. Check drift runs the same
 * pass as the palette command; a finding's commit shows its diff inline;
 * Acknowledge writes `drift-ack:` after the palette command's confirmation.
 * Until drift was checked, the tab says so rather than showing an empty list.
 */
export function Drift(props: Props) {
  const { state, onCheck } = props;
  const checking = state.driftChecking === true;
  const roots = state.roots.filter((r) => !r.error);
  const several = roots.length > 1;
  const total = roots.reduce((n, r) => n + (r.drift.checked ? r.drift.findings.length : 0), 0);
  const checked = roots.length > 0 && roots.every((r) => r.drift.checked);

  return (
    <div class="drift">
      <div class="drift-toolbar">
        <span class="drift-summary" role="status">
          {checking ? "Checking drift…" : !checked ? "Drift not checked yet." : total === 0 ? "No drift found." : `${total} ${total === 1 ? "finding" : "findings"}`}
        </span>
        <button type="button" class="primary" onClick={onCheck} disabled={checking} aria-busy={checking}>
          <span class={`codicon codicon-${checking ? "loading codicon-modifier-spin" : "refresh"}`} aria-hidden="true" /> {checking ? "Checking…" : "Check drift"}
        </button>
      </div>
      {!checked && !checking && (
        <p class="muted">Check drift reads the git history behind each requirement, so it can take a few seconds in a large repository.</p>
      )}
      {roots.map((root) => (
        <section key={root.root} aria-label={several ? root.name : "Drift findings"}>
          {several && <h2>{root.name}</h2>}
          {root.historyError && (
            <p class="load-error" role="alert">
              Could not read the history: {root.historyError}
            </p>
          )}
          {root.drift.checked && root.drift.findings.length > 0 && <RootFindings {...props} root={root} findings={root.drift.findings} />}
        </section>
      ))}
    </div>
  );
}

function RootFindings({ root, findings, diffs, layout, onLayout, onAck, onOpen }: Props & { root: RootView; findings: DriftView[] }) {
  const [open, setOpen] = useState<string | undefined>(undefined);
  const features = [...new Set(findings.map((f) => f.feature))];
  return (
    <>
      {features.map((feature) => {
        const inFeature = findings.filter((f) => f.feature === feature);
        const ids = [...new Set(inFeature.map((f) => f.id ?? ""))];
        return (
          <section key={feature} class="drift-feature" aria-labelledby={`drift-${feature}`}>
            <h2 id={`drift-${feature}`}>{feature}</h2>
            {ids.map((id) => {
              const title = root.features.find((f) => f.name === feature)?.requirements.find((r) => r.id === id)?.title;
              return (
                <div key={id} class="drift-requirement">
                  <h3>
                    {id ? (
                      <button type="button" class="link" onClick={() => onOpen(root.root, feature, id)}>
                        {id}
                        {title && `: ${title}`}
                      </button>
                    ) : (
                      "Feature"
                    )}
                  </h3>
                  <ul>
                    {inFeature
                      .filter((f) => (f.id ?? "") === id)
                      .map((finding, index) => {
                        const key = `${feature}/${id}/${index}`;
                        return (
                          <li key={key} class={`drift-finding ${finding.severity}`}>
                            <div class="finding-line">
                              <span class={`codicon codicon-${severityIcons[finding.severity]}`} aria-label={finding.severity} />
                              <code class="rule">{finding.rule}</code>
                              <span class="message">{finding.message}</span>
                            </div>
                            <div class="finding-actions">
                              {finding.file && <span class="muted">{finding.file}</span>}
                              {finding.commit && (
                                <button type="button" class="link" aria-expanded={open === key} onClick={() => setOpen(open === key ? undefined : key)}>
                                  {open === key ? "Hide" : "Show"} {finding.commit.slice(0, 7)}
                                  {finding.subject && ` "${finding.subject}"`}
                                </button>
                              )}
                              {finding.id && (
                                <button type="button" class="secondary" onClick={() => onAck(root.root, finding)}>
                                  Acknowledge
                                </button>
                              )}
                            </div>
                            {open === key && finding.commit && <CommitDiff root={root.root} commit={finding.commit} diffs={diffs} layout={layout} onLayout={onLayout} />}
                          </li>
                        );
                      })}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}

function CommitDiff({ root, commit, diffs, layout, onLayout }: { root: string; commit: string; diffs: DiffSource; layout: DiffLayout; onLayout: (layout: DiffLayout) => void }) {
  const answer = diffs({ source: "commit", root, commit });
  return (
    <div class="commit-diff" role="region" aria-label={`Diff of commit ${commit.slice(0, 7)}`}>
      <DiffLayoutSwitch layout={layout} onChange={onLayout} />
      {!answer ? (
        <p class="muted">Loading diff…</p>
      ) : "error" in answer ? (
        <p class="load-error" role="alert">
          Could not read the diff: {answer.error}
        </p>
      ) : (
        answer.files.map((file) => <DiffView key={file.path} file={file} layout={layout} />)
      )}
    </div>
  );
}
