// @vitest-environment happy-dom
import { type FileDiff, parseUnifiedDiff } from "@specflow/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import working from "../../../fixtures/diffs/working.patch?raw";
import { DiffLayoutSwitch, DiffView, splitRows, useDiffLayout } from "./diff-view.tsx";
import type { PageState, WebviewApi } from "./vscode-api.ts";

const files = new Map(parseUnifiedDiff(working).map((f) => [f.path, f]));
const file = (path: string) => files.get(path)!;

// Each row's cells as text, empty cells as "".
const rows = () => [...document.querySelectorAll("table.diff tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent!.trim()));

afterEach(cleanup);

describe("DiffView (workbench-ui/R4, R5)", () => {
  it("shows the path, the kind of change and the line counts", () => {
    render(<DiffView file={file("multi.txt")} layout="unified" />);
    const header = within(screen.getByRole("region", { name: "Diff of multi.txt" }).querySelector("header")!);
    expect(header.getByText("modified")).toBeTruthy();
    expect(header.getByText("multi.txt")).toBeTruthy();
    expect(header.getByLabelText("2 added, 2 removed").textContent).toBe("+2 −2");
  });

  it("renders unified hunks with both line numbers", () => {
    render(<DiffView file={file("multi.txt")} layout="unified" />);
    expect(rows().slice(0, 7)).toEqual([
      ["@@ -1,5 +1,5 @@"],
      ["1", "1", "", "one"],
      ["2", "", "-", "two"],
      ["", "2", "+", "TWO"],
      ["3", "3", "", "three"],
      ["4", "4", "", "four"],
      ["5", "5", "", "five"],
    ]);
    expect(rows()[7]).toEqual(["@@ -8,5 +8,5 @@ seven"]);
  });

  it("renders side by side, deletions next to the additions that replace them", () => {
    render(<DiffView file={file("new-name.txt")} layout="split" />);
    expect(screen.getByRole("table").getAttribute("aria-label")).toBe("Side by side diff of new-name.txt");
    expect(rows()).toEqual([
      ["@@ -1,6 +1,6 @@"],
      ["1", "", "a", "1", "", "a"],
      ["2", "", "b", "2", "", "b"],
      ["3", "-", "c", "3", "+", "C"],
      ["4", "", "d", "4", "", "d"],
      ["5", "", "e", "5", "", "e"],
      ["6", "", "f", "6", "", "f"],
    ]);
  });

  it("leaves one side empty when a run has more lines on the other", () => {
    render(<DiffView file={file("nonl.txt")} layout="split" />);
    expect(rows().slice(1)).toEqual([
      ["1", "-", "end", "1", "+", "end"],
      ["", "", "", "2", "+", "more"],
    ]);
  });

  it("marks a last line without a newline", () => {
    render(<DiffView file={file("nonl.txt")} layout="unified" />);
    expect(screen.getAllByLabelText("No newline at end of file")).toHaveLength(1);
  });

  it("names both paths of a rename", () => {
    render(<DiffView file={file("new-name.txt")} layout="unified" />);
    expect(screen.getByRole("region").querySelector(".file-path")!.textContent).toBe("old-name.txt → new-name.txt");
  });

  it("shows placeholders for binary, too large, renamed and mode-only files", () => {
    const cases: [FileDiff, string][] = [
      [file("blob.bin"), "Binary file not shown."],
      [{ ...file("multi.txt"), hunks: [], tooLarge: true, additions: 6000, deletions: 10 }, "Too large to show here (6010 lines changed)."],
      [file("moved.txt"), "Renamed without content changes."],
      [file("script.sh"), "Mode changed from 100644 to 100755."],
    ];
    for (const [diff, text] of cases) {
      const onOpenNative = vi.fn();
      render(<DiffView file={diff} layout="unified" onOpenNative={onOpenNative} />);
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.queryByRole("table")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: `Open ${diff.path} in VS Code diff` }));
      expect(onOpenNative).toHaveBeenCalledOnce();
      cleanup();
    }
  });

  it("renders text as text, never as markup", () => {
    const evil = parseUnifiedDiff(["diff --git a/x.html b/x.html", "--- a/x.html", "+++ b/x.html", "@@ -1 +1 @@", "-<b>old</b>", '+<img src=x onerror="alert(1)">'].join("\n"))[0]!;
    render(<DiffView file={evil} layout="unified" />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeTruthy();
  });
});

describe("splitRows", () => {
  it("pairs each run of deletions with the additions after it, and starts a new run after additions", () => {
    const hunk = parseUnifiedDiff(["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1,4 +1,4 @@", "-a", "-b", "+A", "-c", "+C", "+D", " e"].join("\n"))[0]!.hunks[0]!;
    // -a -b +A is one run; -c +C +D another, since it follows an addition.
    const hunkRows = splitRows(hunk);
    expect(hunkRows.map((r) => [r.old?.text, r.new?.text])).toEqual([
      ["a", "A"],
      ["b", undefined],
      ["c", "C"],
      [undefined, "D"],
      ["e", "e"],
    ]);
  });
});

describe("diff layout (workbench-ui/R4)", () => {
  function Harness({ api }: { api: WebviewApi }) {
    const [layout, setLayout] = useDiffLayout(api);
    return (
      <>
        <DiffLayoutSwitch layout={layout} onChange={setLayout} />
        <DiffView file={file("multi.txt")} layout={layout} />
      </>
    );
  }
  const fakeApi = (state?: PageState): WebviewApi & { state: PageState | undefined } => ({
    state,
    postMessage() {},
    getState() {
      return this.state;
    },
    setState(next) {
      this.state = next;
    },
  });

  it("starts unified, and remembers the layout picked", () => {
    const api = fakeApi({ tab: "review" });
    render(<Harness api={api} />);
    expect(screen.getByRole("button", { name: "Unified" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    expect(screen.getByRole("table").classList.contains("split")).toBe(true);
    expect(api.state).toEqual({ tab: "review", diffLayout: "split" });
  });

  it("comes back on the saved layout", () => {
    render(<Harness api={fakeApi({ diffLayout: "split" })} />);
    expect(screen.getByRole("button", { name: "Side by side" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("table").classList.contains("split")).toBe(true);
  });
});
