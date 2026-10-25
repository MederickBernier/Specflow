// @vitest-environment happy-dom
import { parseUnifiedDiff } from "@specflow/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import rootCommit from "../../../fixtures/diffs/root-commit.patch?raw";
import type { DiffAnswer, DiffRequest, TraceView, WorkbenchState } from "../src/workbench/protocol.ts";
import type { DiffSource } from "./diffs.ts";
import { Trace } from "./trace.tsx";

const root = {
  root: "/repo",
  name: "repo",
  lintProblems: 0,
  drift: { checked: false as const },
  features: [
    {
      name: "auth",
      requirements: [{ id: "R1", title: "Sign in", status: "approved", line: 3 }],
      tasks: [{ id: "T1", title: "Login form", status: "done" as const, reqs: ["R1"], depends: [], waitingOn: [], line: 3 }],
    },
  ],
};
const traced: TraceView = {
  root: "/repo",
  ref: "auth/R1",
  kind: "requirement",
  title: "Sign in",
  status: "approved",
  tasks: [{ feature: "auth", id: "T1", title: "Login form", status: "done" }],
  commits: [
    { hash: "b".repeat(40), date: "2026-02-02T10:00:00+00:00", subject: "fix(auth): trim email", files: [{ status: "M", path: "src/login.ts" }] },
    { hash: "a".repeat(40), date: "2026-01-01T10:00:00+00:00", subject: "feat(auth): login form", files: [{ status: "A", path: "src/login.ts" }, { status: "A", path: "src/form.ts" }] },
  ],
};
const state = (trace?: TraceView): WorkbenchState => ({ revision: 3, roots: [root], harness: { state: "unknown" }, ...(trace && { trace }) });

function diffSource(): DiffSource & { requests: DiffRequest[] } {
  const files = parseUnifiedDiff(rootCommit).slice(0, 2);
  const requests: DiffRequest[] = [];
  const diffs = ((req: DiffRequest) => {
    requests.push(req);
    return { ...req, revision: 3, files, truncated: false } as DiffAnswer;
  }) as DiffSource & { requests: DiffRequest[] };
  diffs.requests = requests;
  return diffs;
}

function show(s: WorkbenchState, diffs: DiffSource = diffSource()) {
  const handlers = { onLayout: vi.fn(), onPick: vi.fn(), onOpen: vi.fn() };
  const view = render(<Trace state={s} diffs={diffs} layout="unified" {...handlers} />);
  return { ...handlers, view };
}

afterEach(cleanup);

describe("Trace tab (workbench-ui/R5)", () => {
  it("offers every requirement and task, and reports the pick", () => {
    const { onPick } = show(state());
    expect(screen.getByText("Pick a requirement or task to see the tasks and commits behind it.")).toBeTruthy();
    const select = screen.getByRole("combobox", { name: "Trace" }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Pick a requirement or task", "R1: Sign in", "T1: Login form"]);
    select.value = select.options[2]!.value;
    fireEvent.change(select);
    expect(onPick).toHaveBeenCalledWith("/repo", "auth/T1");
  });

  it("shows the requirement's tasks with their status and its commits, newest first", () => {
    show(state(traced));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("auth/R1: Sign in");
    const tasks = within(screen.getByRole("region", { name: "Tasks" }));
    expect(tasks.getByRole("listitem").textContent).toContain("auth/T1 Login form done");
    const commits = within(screen.getByRole("region", { name: "Commits" })).getAllByRole("listitem");
    expect(commits.map((c) => c.querySelector(".subject")!.textContent)).toEqual(["fix(auth): trim email", "feat(auth): login form"]);
    expect(commits[1]!.textContent).toContain("aaaaaaa");
    expect(commits[1]!.textContent).toContain("2026-01-01");
    expect(commits[1]!.textContent).toContain("2 files");
    expect(commits[1]!.querySelector(".commit-files")!.textContent).toBe("src/login.ts, src/form.ts");
  });

  it("renders a picked commit's diff inline, and hides it when picked again", () => {
    const diffs = diffSource();
    show(state(traced), diffs);
    expect(screen.queryByRole("region", { name: /^Diff of commit/ })).toBeNull();
    const button = screen.getAllByRole("button", { pressed: false }).find((b) => b.textContent!.includes("feat(auth): login form"))!;
    fireEvent.click(button);
    expect(diffs.requests.at(-1)).toEqual({ source: "commit", root: "/repo", commit: "a".repeat(40) });
    const diff = screen.getByRole("region", { name: "Diff of commit aaaaaaa" });
    expect(within(diff).getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Diff of blob.bin", "Diff of gone.txt"]);
    fireEvent.click(button);
    expect(screen.queryByRole("region", { name: /^Diff of commit/ })).toBeNull();
  });

  it("forgets the picked commit when another item is traced", () => {
    const { view } = show(state(traced));
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent!.includes("feat(auth): login form"))!);
    expect(screen.getByRole("region", { name: /^Diff of commit/ })).toBeTruthy();
    view.rerender(<Trace state={state({ ...traced, ref: "auth/T1", kind: "task" })} diffs={diffSource()} layout="unified" onLayout={vi.fn()} onPick={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.queryByRole("region", { name: /^Diff of commit/ })).toBeNull();
  });

  it("opens the item and its tasks in the editor", () => {
    const { onOpen } = show(state(traced));
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    expect(onOpen).toHaveBeenCalledWith("/repo", "auth", "R1");
    fireEvent.click(screen.getByRole("button", { name: "auth/T1" }));
    expect(onOpen).toHaveBeenLastCalledWith("/repo", "auth", "T1");
  });

  it("says when nothing references the item yet, or it cannot be traced", () => {
    show(state({ ...traced, tasks: [], commits: [] }));
    expect(screen.getByText("No task references it yet.")).toBeTruthy();
    expect(screen.getByText("No commit references it yet.")).toBeTruthy();
    cleanup();
    show(state({ root: "/repo", ref: "auth/R7", error: "No requirement auth/R7" }));
    expect(screen.getByRole("alert").textContent).toBe("Cannot trace auth/R7: No requirement auth/R7");
  });
});
