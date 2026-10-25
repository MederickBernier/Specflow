import type { DiffHunk, DiffLine, FileDiff } from "@specflow/core";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { WebviewApi } from "./vscode-api.ts";

/** How diffs are laid out: one column, or old and new side by side. */
export type DiffLayout = "unified" | "split";

/** The layout the page saved, or unified; choosing one saves it (workbench-ui/R4). */
export function useDiffLayout(api: WebviewApi): [DiffLayout, (layout: DiffLayout) => void] {
  const saved = api.getState()?.diffLayout;
  const [layout, setLayout] = useState<DiffLayout>(saved === "split" ? "split" : "unified");
  return [
    layout,
    (next) => {
      setLayout(next);
      api.setState({ ...api.getState(), diffLayout: next });
    },
  ];
}

/** A two-button switch between the layouts. */
export function DiffLayoutSwitch({ layout, onChange }: { layout: DiffLayout; onChange: (layout: DiffLayout) => void }) {
  return (
    <div class="segmented" role="group" aria-label="Diff layout">
      {(["unified", "split"] as const).map((option) => (
        <button key={option} type="button" aria-pressed={layout === option} class={layout === option ? "selected" : ""} onClick={() => onChange(option)}>
          <span class={`codicon codicon-${option === "unified" ? "list-flat" : "split-horizontal"}`} aria-hidden="true" />{" "}
          {option === "unified" ? "Unified" : "Side by side"}
        </button>
      ))}
    </div>
  );
}

const changeLabels: Record<FileDiff["change"], string> = { added: "added", modified: "modified", deleted: "deleted", renamed: "renamed" };

/**
 * One file's diff (workbench-ui/R4, R5): a header with the path, the kind of
 * change and its line counts, then the hunks with old and new line numbers,
 * unified or side by side. Binary files and files too large to render get
 * a placeholder; `onOpenNative`, when given, opens VS Code's diff editor.
 */
export function DiffView({ file, layout, onOpenNative, extra }: { file: FileDiff; layout: DiffLayout; onOpenNative?: () => void; extra?: ComponentChildren }) {
  const open = onOpenNative && (
    <button type="button" class="secondary" onClick={onOpenNative} aria-label={`Open ${file.path} in VS Code diff`}>
      <span class="codicon codicon-diff" aria-hidden="true" /> Open in VS Code diff
    </button>
  );
  return (
    <section class="file-diff" aria-label={`Diff of ${file.path}`}>
      <header class="file-diff-header">
        <span class={`change-badge ${file.change}`}>{changeLabels[file.change]}</span>
        <span class="file-path">
          {file.from && (
            <>
              <span class="muted">{file.from}</span> →{" "}
            </>
          )}
          {file.path}
        </span>
        {extra}
        <span class="line-counts" aria-label={`${file.additions} added, ${file.deletions} removed`}>
          <span class="additions">+{file.additions}</span> <span class="deletions">−{file.deletions}</span>
        </span>
        {open}
      </header>
      <DiffBody file={file} layout={layout} />
    </section>
  );
}

function DiffBody({ file, layout }: { file: FileDiff; layout: DiffLayout }) {
  if (file.binary) return <p class="diff-placeholder">Binary file not shown.</p>;
  if (file.tooLarge) {
    return <p class="diff-placeholder">Too large to show here ({file.additions + file.deletions} lines changed).</p>;
  }
  if (file.hunks.length === 0) {
    const mode = file.oldMode && file.newMode && file.oldMode !== file.newMode ? `Mode changed from ${file.oldMode} to ${file.newMode}.` : undefined;
    const text = mode ?? (file.change === "renamed" ? "Renamed without content changes." : file.change === "added" ? "Empty file." : "No content changes.");
    return <p class="diff-placeholder">{text}</p>;
  }
  return (
    <div class="diff-scroll">
      <table class={`diff ${layout}`} aria-label={`${layout === "split" ? "Side by side" : "Unified"} diff of ${file.path}`}>
        <tbody>{file.hunks.map((hunk, index) => (layout === "split" ? <SplitHunk key={index} hunk={hunk} /> : <UnifiedHunk key={index} hunk={hunk} />))}</tbody>
      </table>
    </div>
  );
}

const signs = { context: " ", add: "+", del: "-" } as const;

function hunkTitle(hunk: DiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.section ? ` ${hunk.section}` : ""}`;
}

function UnifiedHunk({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      <tr class="hunk-header">
        <td colSpan={4}>{hunkTitle(hunk)}</td>
      </tr>
      {hunk.lines.map((line, index) => (
        <tr key={index} class={`line ${line.kind}`}>
          <td class="ln">{line.oldLine ?? ""}</td>
          <td class="ln">{line.newLine ?? ""}</td>
          <td class="sign">{signs[line.kind]}</td>
          <Code line={line} />
        </tr>
      ))}
    </>
  );
}

type Row = { old?: DiffLine; new?: DiffLine };

/** Pairs a hunk's lines for side by side: context on both sides, each run of deletions next to the additions that follow it. */
export function splitRows(hunk: DiffHunk): Row[] {
  const rows: Row[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ ...(dels[i] && { old: dels[i] }), ...(adds[i] && { new: adds[i] }) });
    dels = [];
    adds = [];
  };
  for (const line of hunk.lines) {
    if (line.kind === "context") {
      flush();
      rows.push({ old: line, new: line });
    } else if (line.kind === "del") {
      // A deletion after additions starts a new run.
      if (adds.length > 0) flush();
      dels.push(line);
    } else {
      adds.push(line);
    }
  }
  flush();
  return rows;
}

function SplitHunk({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      <tr class="hunk-header">
        <td colSpan={6}>{hunkTitle(hunk)}</td>
      </tr>
      {splitRows(hunk).map((row, index) => (
        <tr key={index} class="line">
          <Side line={row.old} number={row.old?.oldLine} />
          <Side line={row.new} number={row.new?.newLine} />
        </tr>
      ))}
    </>
  );
}

function Side({ line, number }: { line?: DiffLine; number?: number }) {
  if (!line) {
    return (
      <>
        <td class="ln empty-side" />
        <td class="sign empty-side" />
        <td class="code empty-side" />
      </>
    );
  }
  return (
    <>
      <td class={`ln ${line.kind}`}>{number ?? ""}</td>
      <td class={`sign ${line.kind}`}>{signs[line.kind]}</td>
      <Code line={line} />
    </>
  );
}

function Code({ line }: { line: DiffLine }) {
  return (
    <td class={`code ${line.kind}`}>
      {line.text}
      {line.noNewline && (
        <span class="no-newline" title="No newline at end of file" aria-label="No newline at end of file">
          {" "}
          <span class="codicon codicon-circle-slash" aria-hidden="true" />
        </span>
      )}
    </td>
  );
}
