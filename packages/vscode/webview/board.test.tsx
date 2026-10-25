// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RootView, TaskView, WorkbenchState } from "../src/workbench/protocol.ts";
import { Board, runBlocker } from "./board.tsx";
import type { FeatureRef } from "./overview.tsx";

const task = (id: string, status: TaskView["status"], extra: Partial<TaskView> = {}): TaskView => ({
  id,
  title: `Task ${id}`,
  status,
  reqs: [],
  depends: [],
  waitingOn: [],
  line: 3,
  ...extra,
});
const root: RootView = {
  root: "/repo",
  name: "repo",
  lintProblems: 0,
  drift: { checked: false },
  features: [
    {
      name: "auth",
      requirements: [],
      tasks: [
        task("T1", "done", { reqs: ["R1"] }),
        task("T2", "todo", { reqs: ["R1", "R2"], depends: ["T1", "billing/T1"], waitingOn: ["billing/T1"] }),
        task("T3", "doing"),
        task("T4", "blocked"),
      ],
    },
    { name: "billing", requirements: [], tasks: [task("T1", "todo")] },
  ],
};
const state = (overrides: Partial<WorkbenchState> = {}): WorkbenchState => ({ revision: 1, roots: [root], harness: { state: "unknown" }, ...overrides });

function show(s: WorkbenchState, filter?: FeatureRef) {
  const handlers = { onFilter: vi.fn(), onRun: vi.fn(), onOpen: vi.fn() };
  render(<Board state={s} {...(filter && { filter })} {...handlers} />);
  return handlers;
}
const column = (title: string) => screen.getByRole("region", { name: new RegExp(`^${title}`) });
const cardsIn = (title: string) => within(column(title)).queryAllByRole("article").map((a) => a.getAttribute("aria-label"));
const card = (name: string) => screen.getByRole("article", { name: new RegExp(`^${name}:`) });

afterEach(cleanup);

describe("Board (workbench-ui/R3)", () => {
  it("has one column per status with a card per task", () => {
    show(state());
    expect(screen.getAllByRole("region").map((r) => r.querySelector("h2")!.textContent!.trim())).toEqual(["To do 2", "Doing 1", "Done 1", "Blocked 1"]);
    expect(cardsIn("To do")).toEqual(["auth/T2: Task T2", "billing/T1: Task T1"]);
    expect(cardsIn("Doing")).toEqual(["auth/T3: Task T3"]);
    expect(cardsIn("Done")).toEqual(["auth/T1: Task T1"]);
    expect(cardsIn("Blocked")).toEqual(["auth/T4: Task T4"]);
  });

  it("shows each task's ID, title, feature, requirements and dependencies", () => {
    show(state());
    const c = within(card("auth/T2"));
    expect(c.getByText("T2")).toBeTruthy();
    expect(c.getByText("Task T2")).toBeTruthy();
    expect(c.getByText("auth")).toBeTruthy();
    expect(c.getByText("R1, R2")).toBeTruthy();
    expect(c.getByText("Depends on T1, billing/T1")).toBeTruthy();
  });

  it("marks a task waiting on dependencies that are not done, naming them", () => {
    show(state());
    expect(card("auth/T2").querySelector(".waiting")!.textContent!.trim()).toBe("Waiting on billing/T1");
    expect(card("auth/T3").querySelector(".waiting")).toBeNull();
  });

  it("runs and opens a task", () => {
    const { onRun, onOpen } = show(state());
    fireEvent.click(within(card("auth/T2")).getByRole("button", { name: "Run auth/T2" }));
    expect(onRun).toHaveBeenCalledWith({ root: "/repo", feature: "auth", task: "T2" });
    fireEvent.click(within(card("auth/T1")).getByRole("button", { name: "Run again auth/T1" }));
    expect(onRun).toHaveBeenLastCalledWith({ root: "/repo", feature: "auth", task: "T1" });
    fireEvent.click(within(card("billing/T1")).getByRole("button", { name: "Open billing/T1" }));
    expect(onOpen).toHaveBeenCalledWith({ root: "/repo", feature: "billing", task: "T1" });
  });

  it("disables Run, saying why, while a run is in progress or under review", () => {
    for (const s of [state({ run: { target: "auth/T3", status: "running" } }), state({ review: { root: "/repo", target: "auth/T3", files: [], specNotes: [] } })]) {
      const { onRun } = show(s);
      const button = within(card("auth/T2")).getByRole("button", { name: "Run auth/T2" }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.title).toBe(runBlocker(s));
      expect(screen.getByRole("status").textContent).toContain(runBlocker(s));
      fireEvent.click(button);
      expect(onRun).not.toHaveBeenCalled();
      cleanup();
    }
    expect(runBlocker(state({ run: { target: "auth/T3", status: "running" } }))).toBe("auth/T3 is running");
    expect(runBlocker(state({ run: { target: "auth/T3", status: "done" } }))).toBeUndefined();
    expect(runBlocker(state({ review: { root: "/repo", target: "auth/T3", files: [], specNotes: [] } }))).toBe("Accept or discard auth/T3 first");
  });

  it("filters by feature", () => {
    const { onFilter } = show(state(), { root: "/repo", feature: "billing" });
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["billing/T1: Task T1"]);
    expect(within(card("billing/T1")).queryByText("billing")).toBeNull();
    const select = screen.getByRole("combobox", { name: "Feature" }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["All features", "auth", "billing"]);
    select.value = select.options[1]!.value;
    fireEvent.change(select);
    expect(onFilter).toHaveBeenCalledWith({ root: "/repo", feature: "auth" });
    select.value = "";
    fireEvent.change(select);
    expect(onFilter).toHaveBeenLastCalledWith(undefined);
  });

  it("shows every task when the filtered feature is gone", () => {
    show(state(), { root: "/repo", feature: "removed" });
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
  });
});
