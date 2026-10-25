import { useEffect, useRef, useState } from "preact/hooks";
import { isWorkbenchTab, type WorkbenchTab, workbenchTabs } from "../src/workbench/html.ts";
import type { WorkbenchCommand, WorkbenchState } from "../src/workbench/protocol.ts";
import { Board, type TaskRef } from "./board.tsx";
import { useDiffLayout } from "./diff-view.tsx";
import { useDiffs } from "./diffs.ts";
import { Review } from "./review.tsx";
import { Trace } from "./trace.tsx";
import { Drift } from "./drift.tsx";
import { type FeatureRef, Overview } from "./overview.tsx";
import type { WebviewApi } from "./vscode-api.ts";

const labels: Record<WorkbenchTab, { title: string; icon: string; hint: string }> = {
  overview: { title: "Overview", icon: "dashboard", hint: "Where every feature stands." },
  board: { title: "Board", icon: "project", hint: "Tasks by status, ready to run." },
  review: { title: "Review", icon: "diff", hint: "The diff of a run under review, or of the working tree." },
  trace: { title: "Trace", icon: "git-commit", hint: "A requirement's tasks and commits." },
  drift: { title: "Drift", icon: "warning", hint: "Code and spec that no longer agree." },
};

/**
 * The workbench page (workbench-ui/R1): a tab bar following the ARIA tabs
 * pattern (arrow keys, Home and End move between tabs) and one panel per tab.
 * The current tab is saved with `setState`, which VS Code keeps while the
 * panel is hidden and across reloads. Until the extension sends its first
 * state, the panel says it is loading.
 */
export function App({ api, initialTab, state }: { api: WebviewApi; initialTab?: WorkbenchTab; state?: WorkbenchState }) {
  const saved = api.getState()?.tab;
  const [tab, setTab] = useState<WorkbenchTab>(isWorkbenchTab(saved) ? saved : (initialTab ?? "overview"));
  const [filter, setFilter] = useState<FeatureRef | undefined>(api.getState()?.filter);
  const diffs = useDiffs(api, state?.revision);
  const [layout, setLayout] = useDiffLayout(api);
  const tabRefs = useRef<Partial<Record<WorkbenchTab, HTMLButtonElement | null>>>({});

  const select = (next: WorkbenchTab, focus = false) => {
    setTab(next);
    api.setState({ ...api.getState(), tab: next });
    if (focus) tabRefs.current[next]?.focus();
  };

  const saveFilter = (ref: FeatureRef | undefined) => {
    setFilter(ref);
    const { filter: _, ...rest } = api.getState() ?? {};
    api.setState(ref ? { ...rest, filter: ref } : rest);
  };
  // workbench-ui/R2: a feature card opens the Board filtered to that feature.
  const openFeature = (ref: FeatureRef) => {
    saveFilter(ref);
    select("board");
  };
  const run = ({ root, feature, task }: TaskRef) => api.postMessage({ type: "run", root, feature, task });
  const open = ({ root, feature, task }: TaskRef) => api.postMessage({ type: "open", root, feature, id: task });
  const command = (name: WorkbenchCommand) => api.postMessage({ type: "command", command: name });

  // The host learns the current tab from a `tab` message.
  useEffect(() => {
    api.postMessage({ type: "tab", tab });
  }, [tab]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: unknown; tab?: unknown } | undefined;
      if (message?.type === "show" && isWorkbenchTab(message.tab)) select(message.tab);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    const index = workbenchTabs.indexOf(tab);
    const last = workbenchTabs.length - 1;
    const target =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : undefined;
    if (target === undefined) return;
    event.preventDefault();
    select(workbenchTabs[target]!, true);
  };

  return (
    <div class="workbench">
      <nav role="tablist" aria-label="Specflow workbench" class="tabs" onKeyDown={onKeyDown}>
        {workbenchTabs.map((id) => (
          <button
            key={id}
            ref={(el) => {
              tabRefs.current[id] = el;
            }}
            id={`tab-${id}`}
            role="tab"
            type="button"
            aria-selected={id === tab}
            aria-controls={`panel-${id}`}
            tabIndex={id === tab ? 0 : -1}
            class={id === tab ? "tab selected" : "tab"}
            title={labels[id].hint}
            onClick={() => select(id)}
          >
            <span class={`codicon codicon-${labels[id].icon}`} aria-hidden="true" />
            {labels[id].title}
          </button>
        ))}
      </nav>
      <section id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0} class="panel">
        <h1>{labels[tab].title}</h1>
        {!state ? (
          <p class="empty">Loading specs…</p>
        ) : tab === "overview" ? (
          <Overview state={state} onOpenFeature={openFeature} onCommand={command} />
        ) : tab === "board" ? (
          <Board state={state} {...(filter && { filter })} onFilter={saveFilter} onRun={run} onOpen={open} />
        ) : tab === "review" ? (
          <Review
            state={state}
            diffs={diffs}
            layout={layout}
            onLayout={setLayout}
            onCommand={command}
            onOpenNative={(path) => api.postMessage({ type: "openDiff", path })}
          />
        ) : tab === "trace" ? (
          <Trace
            state={state}
            diffs={diffs}
            layout={layout}
            onLayout={setLayout}
            onPick={(root, ref) => api.postMessage({ type: "trace", root, ref })}
            onOpen={(root, feature, id) => api.postMessage({ type: "open", root, feature, id })}
          />
        ) : (
          <Drift
            state={state}
            diffs={diffs}
            layout={layout}
            onLayout={setLayout}
            onCheck={() => command("checkDrift")}
            onAck={(root, finding) => api.postMessage({ type: "ack", root, feature: finding.feature, id: finding.id, ...(finding.commit && { commit: finding.commit }) })}
            onOpen={(root, feature, id) => api.postMessage({ type: "open", root, feature, id })}
          />
        )}
      </section>
    </div>
  );
}
