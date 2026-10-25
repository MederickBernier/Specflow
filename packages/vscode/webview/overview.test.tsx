// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RootView, WorkbenchState } from "../src/workbench/protocol.ts";
import { Overview } from "./overview.tsx";

const auth: RootView["features"][number] = {
  name: "auth",
  requirements: [
    { id: "R1", title: "Sign in", status: "approved", line: 3 },
    { id: "R2", title: "Lockout", status: "approved", line: 9 },
    { id: "R3", title: "SSO", status: "draft", line: 15 },
  ],
  tasks: [
    { id: "T1", title: "Form", status: "done", reqs: ["R1"], depends: [], waitingOn: [], line: 3 },
    { id: "T2", title: "Counter", status: "done", reqs: ["R2"], depends: [], waitingOn: [], line: 8 },
    { id: "T3", title: "Lock", status: "doing", reqs: ["R2"], depends: ["T2"], waitingOn: [], line: 13 },
    { id: "T4", title: "SSO", status: "blocked", reqs: ["R3"], depends: [], waitingOn: [], line: 18 },
  ],
};
const billing: RootView["features"][number] = { name: "billing", requirements: [], tasks: [] };

const root = (overrides: Partial<RootView> = {}): RootView => ({
  root: "/repo",
  name: "repo",
  features: [auth, billing],
  lintProblems: 0,
  drift: { checked: false },
  ...overrides,
});
const state = (overrides: Partial<WorkbenchState> = {}): WorkbenchState => ({ revision: 1, roots: [root()], harness: { state: "unknown" }, ...overrides });

function show(s: WorkbenchState) {
  const onOpenFeature = vi.fn();
  const onCommand = vi.fn();
  render(<Overview state={s} onOpenFeature={onOpenFeature} onCommand={onCommand} />);
  return { onOpenFeature, onCommand };
}
const card = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}:`) });
const stat = (label: string) => screen.getByText(label).closest(".stat") as HTMLElement;

afterEach(cleanup);

describe("Overview (workbench-ui/R2)", () => {
  it("counts each feature's requirements and tasks by status, with its share done", () => {
    show(state());
    const c = within(card("auth"));
    expect(card("auth").getAttribute("aria-label")).toBe("auth: 2 of 4 tasks done. Open on the board.");
    expect(c.getByText("2 of 4 tasks done · 50%")).toBeTruthy();
    expect(c.getByText("3 requirements: 2 approved · 1 draft")).toBeTruthy();
    expect(card("auth").querySelector('[data-kind="tasks"]')!.textContent!.trim()).toBe("1 doing 2 done 1 blocked");
    const progress = card("auth").querySelector("progress")!;
    expect([progress.getAttribute("value"), progress.getAttribute("max")]).toEqual(["2", "4"]);
  });

  it("says when a feature has no tasks or requirements yet", () => {
    show(state());
    const c = within(card("billing"));
    expect(c.getByText("No tasks yet")).toBeTruthy();
    expect(c.getByText("No requirements")).toBeTruthy();
    expect(card("billing").querySelector("progress")).toBeNull();
  });

  it("opens the Board on a feature", () => {
    const { onOpenFeature } = show(state());
    fireEvent.click(card("auth"));
    expect(onOpenFeature).toHaveBeenCalledWith({ root: "/repo", feature: "auth" });
  });

  it("shows lint problems with a way to the Problems panel", () => {
    const { onCommand } = show(state({ roots: [root({ lintProblems: 3 })] }));
    expect(within(stat("Lint")).getByText("3 problems")).toBeTruthy();
    fireEvent.click(within(stat("Lint")).getByRole("button", { name: "Show problems" }));
    expect(onCommand).toHaveBeenCalledWith("showProblems");
    cleanup();
    show(state());
    expect(within(stat("Lint")).getByText("No problems")).toBeTruthy();
    expect(within(stat("Lint")).queryByRole("button")).toBeNull();
  });

  it("says drift was not checked, and offers to check it", () => {
    const { onCommand } = show(state());
    expect(within(stat("Drift")).getByText("Not checked")).toBeTruthy();
    fireEvent.click(within(stat("Drift")).getByRole("button", { name: "Check drift" }));
    expect(onCommand).toHaveBeenCalledWith("checkDrift");
  });

  it("counts drift findings, overall and per feature", () => {
    const finding = { rule: "drift/code-changed-since-spec", severity: "warning" as const, message: "m", feature: "auth", id: "R1", line: 3 };
    show(state({ roots: [root({ drift: { checked: true, findings: [finding, { ...finding, id: "R2" }] } })] }));
    expect(within(stat("Drift")).getByText("2 findings")).toBeTruthy();
    expect(within(card("auth")).getByText("2 drift findings")).toBeTruthy();
    expect(within(card("billing")).queryByText(/drift/)).toBeNull();
    cleanup();
    show(state({ roots: [root({ drift: { checked: true, findings: [] } })] }));
    expect(within(stat("Drift")).getByText("No drift")).toBeTruthy();
  });

  it("shows harness health", () => {
    const { onCommand } = show(state({ harness: { state: "ready", name: "claude-code", version: "2.1.3", warnings: [] } }));
    expect(within(stat("Harness")).getByText("claude-code 2.1.3 · ready")).toBeTruthy();
    fireEvent.click(within(stat("Harness")).getByRole("button", { name: "Check harness" }));
    expect(onCommand).toHaveBeenCalledWith("checkHarness");
    cleanup();
    show(state({ harness: { state: "problem", name: "claude-code", message: "Specflow can't run tasks: claude was not found on PATH" } }));
    expect(within(stat("Harness")).getByText("Specflow can't run tasks: claude was not found on PATH")).toBeTruthy();
    cleanup();
    show(state());
    expect(within(stat("Harness")).getByText("Not checked")).toBeTruthy();
  });

  it("shows a load error instead of features", () => {
    show(state({ roots: [root({ error: "config.yml: version must be 1", features: [] })] }));
    expect(screen.getByRole("alert").textContent).toContain("config.yml: version must be 1");
    expect(screen.queryByRole("button", { name: /^auth:/ })).toBeNull();
    expect(within(stat("Lint")).getByText("1 problem")).toBeTruthy();
  });

  it("names each root when there are several", () => {
    show(state({ roots: [root(), root({ root: "/other", name: "other", features: [billing] })] }));
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["repo", "other"]);
    expect(screen.getAllByRole("button", { name: /^billing:/ })).toHaveLength(2);
  });
});
