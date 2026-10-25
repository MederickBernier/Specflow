import type { FileDiff } from "@specflow/core";
import { useState } from "preact/hooks";
import type { DiffAnswer, ReviewView, RootView, WorkbenchCommand, WorkbenchState } from "../src/workbench/protocol.ts";
import { type DiffLayout, DiffLayoutSwitch, DiffView } from "./diff-view.tsx";
import type { DiffSource } from "./diffs.ts";

/** Up to this many files, every diff is shown; above it, only the selected one. */
export const expandAllBelow = 20;

type Props = {
  state: WorkbenchState;
  diffs: DiffSource;
  layout: DiffLayout;
  onLayout: (layout: DiffLayout) => void;
  onCommand: (command: WorkbenchCommand) => void;
  onOpenNative: (path: string) => void;
};

/**
 * The Review tab (workbench-ui/R4). With a staged run under review: its files
 * with line counts and scope marks, the agent's spec notes, inline diffs
 * against HEAD, and Accept and commit / Discard changes through the palette
 * commands. Without one: the working tree's uncommitted changes, read only.
 */
export function Review(props: Props) {
  return props.state.review ? <RunReview {...props} review={props.state.review} /> : <WorkingChanges {...props} />;
}

function RunReview({ review, diffs, layout, onLayout, onCommand, onOpenNative }: Props & { review: ReviewView }) {
  const answer = diffs({ source: "review", root: review.root });
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const byPath = new Map(answer && "files" in answer ? answer.files.map((f) => [f.path, f]) : []);
  const expandAll = review.files.length < expandAllBelow;
  const shown = expandAll ? review.files : review.files.filter((f) => f.path === (selected ?? review.files[0]?.path));
  const outside = review.files.filter((f) => f.outOfScope).length;

  return (
    <div class="review">
      <div class="review-toolbar">
        <span class="review-title">
          Run of <strong>{review.target}</strong> · {review.files.length} {review.files.length === 1 ? "file" : "files"}
        </span>
        <DiffLayoutSwitch layout={layout} onChange={onLayout} />
        <button type="button" class="primary" onClick={() => onCommand("acceptRun")}>
          <span class="codicon codicon-check" aria-hidden="true" /> Accept and commit
        </button>
        <button type="button" class="secondary" onClick={() => onCommand("discardRun")}>
          <span class="codicon codicon-discard" aria-hidden="true" /> Discard changes
        </button>
      </div>

      {outside > 0 && (
        <p class="scope-warning" role="note">
          <span class="codicon codicon-warning" aria-hidden="true" /> {outside} {outside === 1 ? "file is" : "files are"} outside the task's files list. Check they belong to this
          task, or the trace will attribute them to the wrong requirement.
        </p>
      )}

      {review.specNotes.length > 0 && (
        <section class="spec-notes" aria-labelledby="spec-notes-title">
          <h2 id="spec-notes-title">Spec notes from the agent (not applied)</h2>
          <ul>
            {review.specNotes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <ul class="review-files" aria-label="Changed files">
        {review.files.map((file) => {
          const diff = byPath.get(file.path);
          return (
            <li key={file.path} class={file.path === (selected ?? review.files[0]?.path) && !expandAll ? "selected" : ""}>
              <button type="button" class="link" onClick={() => (expandAll ? document.getElementById(anchor(file.path))?.scrollIntoView() : setSelected(file.path))}>
                {file.path}
              </button>{" "}
              <span class={`change-badge ${file.change}`}>{file.change}</span>
              {diff && (
                <span class="line-counts">
                  {" "}
                  <span class="additions">+{diff.additions}</span> <span class="deletions">−{diff.deletions}</span>
                </span>
              )}
              {file.outOfScope && (
                <span class="out-of-scope" title="Not in the task's files list">
                  {" "}
                  <span class="codicon codicon-warning" aria-hidden="true" /> outside the task's files
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <DiffList answer={answer} paths={shown.map((f) => f.path)} layout={layout} onOpenNative={onOpenNative} byPath={byPath} />
    </div>
  );
}

function WorkingChanges({ state, diffs, layout, onLayout, onCommand }: Props) {
  const roots = state.roots.filter((root) => !root.error);
  return (
    <div class="review">
      <div class="review-toolbar">
        <span class="review-title">Uncommitted changes against HEAD · read only</span>
        <DiffLayoutSwitch layout={layout} onChange={onLayout} />
        <button type="button" class="secondary" onClick={() => onCommand("refresh")}>
          <span class="codicon codicon-refresh" aria-hidden="true" /> Refresh
        </button>
      </div>
      <p class="muted">No run is under review. Run a task from the Board to review its result here.</p>
      {roots.map((root) => (
        <WorkingRoot key={root.root} root={root} several={roots.length > 1} diffs={diffs} layout={layout} />
      ))}
    </div>
  );
}

function WorkingRoot({ root, several, diffs, layout }: { root: RootView; several: boolean; diffs: DiffSource; layout: DiffLayout }) {
  const answer = diffs({ source: "working", root: root.root });
  const files = answer && "files" in answer ? answer.files : [];
  return (
    <section aria-label={several ? root.name : "Working tree"}>
      {several && <h2>{root.name}</h2>}
      {answer && "files" in answer && files.length === 0 ? (
        <p class="empty">No uncommitted changes.</p>
      ) : (
        <DiffList answer={answer} paths={files.map((f) => f.path)} layout={layout} byPath={new Map(files.map((f) => [f.path, f]))} />
      )}
    </section>
  );
}

function DiffList({
  answer,
  paths,
  byPath,
  layout,
  onOpenNative,
}: {
  answer: DiffAnswer | undefined;
  paths: string[];
  byPath: Map<string, FileDiff>;
  layout: DiffLayout;
  onOpenNative?: (path: string) => void;
}) {
  if (!answer) return <p class="muted">Loading diff…</p>;
  if ("error" in answer) {
    return (
      <p class="load-error" role="alert">
        Could not read the diff: {answer.error}
      </p>
    );
  }
  return (
    <div class="diffs">
      {paths.map((path) => {
        const file = byPath.get(path);
        return (
          <div key={path} id={anchor(path)}>
            {file ? (
              <DiffView file={file} layout={layout} {...(onOpenNative && { onOpenNative: () => onOpenNative(path) })} />
            ) : (
              <p class="diff-placeholder">{path}: no changes against HEAD.</p>
            )}
          </div>
        );
      })}
      {answer.truncated && <p class="muted">Some files are not shown: the diff is over 10 MB.</p>}
    </div>
  );
}

function anchor(path: string): string {
  return `diff-${encodeURIComponent(path)}`;
}
