import { useEffect, useState } from "preact/hooks";
import type { CommitView, TraceView, WorkbenchState } from "../src/workbench/protocol.ts";
import { type DiffLayout, DiffLayoutSwitch, DiffView } from "./diff-view.tsx";
import type { DiffSource } from "./diffs.ts";

const statusIcons: Record<string, string> = { todo: "circle-large-outline", doing: "sync", done: "pass", blocked: "circle-slash" };

type Props = {
  state: WorkbenchState;
  diffs: DiffSource;
  layout: DiffLayout;
  onLayout: (layout: DiffLayout) => void;
  onPick: (root: string, ref: string) => void;
  onOpen: (root: string, feature: string, id: string) => void;
};

/**
 * The Trace tab (workbench-ui/R5): pick a requirement or task, see its tasks
 * with their status and the commits that implement it, newest first, and a
 * picked commit's diff inline. The extension keeps the pick, so the
 * requirement lens and the Specs view can open the tab on an item.
 */
export function Trace({ state, diffs, layout, onLayout, onPick, onOpen }: Props) {
  const traced = state.trace;
  const [commit, setCommit] = useState<string | undefined>(undefined);
  // A new pick starts without a commit.
  useEffect(() => setCommit(undefined), [traced?.root, traced?.ref]);
  const several = state.roots.length > 1;

  return (
    <div class="trace">
      <div class="trace-toolbar">
        <label>
          Trace{" "}
          <select
            value={traced ? JSON.stringify([traced.root, traced.ref]) : ""}
            onChange={(event) => {
              const value = (event.currentTarget as HTMLSelectElement).value;
              if (value) onPick(...(JSON.parse(value) as [string, string]));
            }}
          >
            <option value="" disabled>
              Pick a requirement or task
            </option>
            {state.roots.flatMap((root) =>
              root.features.map((feature) => (
                <optgroup key={`${root.root}/${feature.name}`} label={several ? `${root.name} / ${feature.name}` : feature.name}>
                  {[...feature.requirements, ...feature.tasks].map((item) => (
                    <option key={item.id} value={JSON.stringify([root.root, `${feature.name}/${item.id}`])}>
                      {item.id}: {item.title}
                    </option>
                  ))}
                </optgroup>
              )),
            )}
          </select>
        </label>
      </div>
      {!traced ? (
        <p class="empty">Pick a requirement or task to see the tasks and commits behind it.</p>
      ) : "error" in traced ? (
        <p class="load-error" role="alert">
          Cannot trace {traced.ref}: {traced.error}
        </p>
      ) : (
        <Traced traced={traced} commit={commit} onCommit={setCommit} diffs={diffs} layout={layout} onLayout={onLayout} onOpen={onOpen} />
      )}
    </div>
  );
}

function Traced({
  traced,
  commit,
  onCommit,
  diffs,
  layout,
  onLayout,
  onOpen,
}: {
  traced: Extract<TraceView, { kind: string }>;
  commit: string | undefined;
  onCommit: (hash: string | undefined) => void;
  diffs: DiffSource;
  layout: DiffLayout;
  onLayout: (layout: DiffLayout) => void;
  onOpen: (root: string, feature: string, id: string) => void;
}) {
  const [feature, id] = [traced.ref.slice(0, traced.ref.lastIndexOf("/")), traced.ref.slice(traced.ref.lastIndexOf("/") + 1)];
  return (
    <>
      <header class="trace-header">
        <h2>
          {traced.ref}: {traced.title}
        </h2>
        <span class="chip">{traced.status}</span>
        <button type="button" class="link" onClick={() => onOpen(traced.root, feature, id)}>
          Open in editor
        </button>
      </header>

      {traced.kind === "requirement" && (
        <section aria-labelledby="trace-tasks">
          <h3 id="trace-tasks">Tasks</h3>
          {traced.tasks.length === 0 ? (
            <p class="muted">No task references it yet.</p>
          ) : (
            <ul class="trace-tasks">
              {traced.tasks.map((task) => (
                <li key={`${task.feature}/${task.id}`}>
                  <span class={`codicon codicon-${statusIcons[task.status] ?? "circle-large-outline"}`} aria-hidden="true" />{" "}
                  <button type="button" class="link" onClick={() => onOpen(traced.root, task.feature, task.id)}>
                    {task.feature}/{task.id}
                  </button>{" "}
                  {task.title} <span class="muted">{task.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="trace-commits">
        <h3 id="trace-commits">Commits</h3>
        {traced.commits.length === 0 ? (
          <p class="muted">No commit references it yet.</p>
        ) : (
          <ul class="trace-commits">
            {traced.commits.map((c) => (
              <CommitItem key={c.hash} commit={c} selected={c.hash === commit} onPick={() => onCommit(c.hash === commit ? undefined : c.hash)} />
            ))}
          </ul>
        )}
      </section>

      {commit && <CommitDiff root={traced.root} commit={commit} diffs={diffs} layout={layout} onLayout={onLayout} />}
    </>
  );
}

function CommitItem({ commit, selected, onPick }: { commit: CommitView; selected: boolean; onPick: () => void }) {
  return (
    <li class={selected ? "selected" : ""}>
      <button type="button" class="commit" aria-pressed={selected} onClick={onPick}>
        <code class="hash">{commit.hash.slice(0, 7)}</code>
        <span class="muted">{commit.date.slice(0, 10)}</span>
        <span class="subject">{commit.subject}</span>
        <span class="muted">
          {commit.files.length} {commit.files.length === 1 ? "file" : "files"}
        </span>
      </button>
      <span class="commit-files muted">{commit.files.map((f) => f.path).join(", ")}</span>
    </li>
  );
}

function CommitDiff({ root, commit, diffs, layout, onLayout }: { root: string; commit: string; diffs: DiffSource; layout: DiffLayout; onLayout: (layout: DiffLayout) => void }) {
  const answer = diffs({ source: "commit", root, commit });
  return (
    <section class="commit-diff" aria-label={`Diff of commit ${commit.slice(0, 7)}`}>
      <div class="trace-toolbar">
        <h3>Changes in {commit.slice(0, 7)}</h3>
        <DiffLayoutSwitch layout={layout} onChange={onLayout} />
      </div>
      {!answer ? (
        <p class="muted">Loading diff…</p>
      ) : "error" in answer ? (
        <p class="load-error" role="alert">
          Could not read the diff: {answer.error}
        </p>
      ) : (
        <>
          {answer.files.map((file) => (
            <DiffView key={file.path} file={file} layout={layout} />
          ))}
          {answer.truncated && <p class="muted">Some files are not shown: the diff is over 10 MB.</p>}
        </>
      )}
    </section>
  );
}
