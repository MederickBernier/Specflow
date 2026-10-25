// @vitest-environment happy-dom
import { type FileDiff, parseUnifiedDiff } from "@specflow/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import working from "../../../fixtures/diffs/working.patch?raw";
import type { DiffAnswer, DiffRequest, ReviewView, WorkbenchState } from "../src/workbench/protocol.ts";
import type { DiffSource } from "./diffs.ts";
import { expandAllBelow, Review } from "./review.tsx";

const recorded = new Map(parseUnifiedDiff(working).map((f) => [f.path, f]));
const root = { root: "/repo", name: "repo", lintProblems: 0, drift: { checked: false as const }, features: [] };
const review: ReviewView = {
  root: "/repo",
  target: "accounts/T3",
  files: [
    { path: "multi.txt", change: "modified", outOfScope: false },
    { path: "blob.bin", change: "modified", outOfScope: false },
    { path: "added.txt", change: "added", outOfScope: true },
  ],
  specNotes: ["R2 does not say how long the lockout lasts."],
};
const state = (overrides: Partial<WorkbenchState> = {}): WorkbenchState => ({ revision: 2, roots: [root], harness: { state: "unknown" }, review, ...overrides });

/** A DiffSource answering every request with `files`, recording the requests. */
function source(files: FileDiff[] | undefined, extra: Partial<DiffAnswer> = {}): DiffSource & { requests: DiffRequest[] } {
  const requests: DiffRequest[] = [];
  const diffs = ((req: DiffRequest) => {
    requests.push(req);
    return files && ({ ...req, revision: 2, files, truncated: false, ...extra } as DiffAnswer);
  }) as DiffSource & { requests: DiffRequest[] };
  diffs.requests = requests;
  return diffs;
}

function show(s: WorkbenchState, diffs: DiffSource) {
  const handlers = { onLayout: vi.fn(), onCommand: vi.fn(), onOpenNative: vi.fn() };
  render(<Review state={s} diffs={diffs} layout="unified" {...handlers} />);
  return handlers;
}
const fileItem = (path: string) => within(screen.getByRole("list", { name: "Changed files" })).getByText(path).closest("li")!;

afterEach(cleanup);

describe("Review tab with a run under review (workbench-ui/R4)", () => {
  const files = ["multi.txt", "blob.bin", "added.txt"].map((p) => recorded.get(p)!);

  it("asks for the run's diff, and lists its files with counts and scope marks", () => {
    const diffs = source(files);
    show(state(), diffs);
    expect(diffs.requests[0]).toEqual({ source: "review", root: "/repo" });
    expect(fileItem("multi.txt").textContent).toContain("+2 −2");
    expect(fileItem("added.txt").textContent).toContain("outside the task's files");
    expect(fileItem("multi.txt").textContent).not.toContain("outside");
    expect(screen.getByRole("note").textContent).toContain("1 file is outside the task's files list");
  });

  it("shows the spec notes", () => {
    show(state(), source(files));
    const notes = screen.getByRole("region", { name: "Spec notes from the agent (not applied)" });
    expect(within(notes).getByText("R2 does not say how long the lockout lasts.")).toBeTruthy();
  });

  it("renders each file's diff inline, with a placeholder for the binary one", () => {
    show(state(), source(files));
    expect(screen.getAllByRole("region", { name: /^Diff of / }).map((r) => r.getAttribute("aria-label"))).toEqual([
      "Diff of multi.txt",
      "Diff of blob.bin",
      "Diff of added.txt",
    ]);
    expect(screen.getByText("Binary file not shown.")).toBeTruthy();
  });

  it("accepts, discards and opens VS Code's diff editor", () => {
    const { onCommand, onOpenNative } = show(state(), source(files));
    fireEvent.click(screen.getByRole("button", { name: "Accept and commit" }));
    expect(onCommand).toHaveBeenCalledWith("acceptRun");
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onCommand).toHaveBeenLastCalledWith("discardRun");
    fireEvent.click(screen.getByRole("button", { name: "Open blob.bin in VS Code diff" }));
    expect(onOpenNative).toHaveBeenCalledWith("blob.bin");
  });

  it("says when the diff is loading or could not be read", () => {
    show(state(), source(undefined));
    expect(screen.getByText("Loading diff…")).toBeTruthy();
    cleanup();
    const failing = ((req: DiffRequest) => ({ ...req, revision: 2, error: "not a git repository" })) as DiffSource;
    show(state(), failing);
    expect(screen.getByRole("alert").textContent).toBe("Could not read the diff: not a git repository");
  });

  it(`shows only the selected file's diff from ${expandAllBelow} files on`, () => {
    const many = Array.from({ length: expandAllBelow }, (_, i) => ({ ...recorded.get("multi.txt")!, path: `f${i}.txt` }));
    show(state({ review: { ...review, files: many.map((f) => ({ path: f.path, change: "modified", outOfScope: false })) } }), source(many));
    expect(screen.getAllByRole("region", { name: /^Diff of / }).map((r) => r.getAttribute("aria-label"))).toEqual(["Diff of f0.txt"]);
    fireEvent.click(within(screen.getByRole("list", { name: "Changed files" })).getByText("f7.txt"));
    expect(screen.getAllByRole("region", { name: /^Diff of / }).map((r) => r.getAttribute("aria-label"))).toEqual(["Diff of f7.txt"]);
  });

  it("says when the diff was cut short", () => {
    show(state(), source(files, { truncated: true }));
    expect(screen.getByText("Some files are not shown: the diff is over 10 MB.")).toBeTruthy();
  });
});

describe("Review tab without a run (workbench-ui/R4)", () => {
  it("shows the working tree's changes, read only", () => {
    const diffs = source([recorded.get("multi.txt")!, recorded.get("added.txt")!]);
    const { onCommand } = show(state({ review: undefined }), diffs);
    expect(diffs.requests).toEqual([{ source: "working", root: "/repo" }]);
    expect(screen.getByText("Uncommitted changes against HEAD · read only")).toBeTruthy();
    expect(screen.getAllByRole("region", { name: /^Diff of / })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Accept and commit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /in VS Code diff/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onCommand).toHaveBeenCalledWith("refresh");
  });

  it("says when there is nothing uncommitted", () => {
    show(state({ review: undefined }), source([]));
    expect(screen.getByText("No uncommitted changes.")).toBeTruthy();
  });
});
