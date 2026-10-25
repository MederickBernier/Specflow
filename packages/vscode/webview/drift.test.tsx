// @vitest-environment happy-dom
import { parseUnifiedDiff } from "@specflow/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import working from "../../../fixtures/diffs/working.patch?raw";
import type { DiffAnswer, DiffRequest, DriftView, RootView, WorkbenchState } from "../src/workbench/protocol.ts";
import type { DiffSource } from "./diffs.ts";
import { Drift } from "./drift.tsx";

const changed: DriftView = {
  rule: "drift/code-changed-since-spec",
  severity: "warning",
  message: 'src/login.ts changed in abc1234 "fix: reject empty passwords" after the spec last changed',
  feature: "auth",
  id: "R1",
  line: 3,
  file: "src/login.ts",
  commit: "abc1234def",
  subject: "fix: reject empty passwords",
};
const unimplemented: DriftView = { rule: "drift/unimplemented", severity: "info", message: "No commit implements it", feature: "auth", id: "R2", line: 9 };
const root = (overrides: Partial<RootView> = {}): RootView => ({
  root: "/repo",
  name: "repo",
  lintProblems: 0,
  features: [
    {
      name: "auth",
      requirements: [
        { id: "R1", title: "Sign in", status: "approved", line: 3 },
        { id: "R2", title: "Lockout", status: "approved", line: 9 },
      ],
      tasks: [],
    },
  ],
  drift: { checked: true, findings: [changed, unimplemented] },
  ...overrides,
});
const state = (overrides: Partial<WorkbenchState> = {}): WorkbenchState => ({ revision: 1, roots: [root()], harness: { state: "unknown" }, ...overrides });

function diffSource(): DiffSource & { requests: DiffRequest[] } {
  const requests: DiffRequest[] = [];
  const diffs = ((req: DiffRequest) => {
    requests.push(req);
    return { ...req, revision: 1, files: parseUnifiedDiff(working).slice(0, 1), truncated: false } as DiffAnswer;
  }) as DiffSource & { requests: DiffRequest[] };
  diffs.requests = requests;
  return diffs;
}

function show(s: WorkbenchState, diffs: DiffSource = diffSource()) {
  const handlers = { onLayout: vi.fn(), onCheck: vi.fn(), onAck: vi.fn(), onOpen: vi.fn() };
  render(<Drift state={s} diffs={diffs} layout="unified" {...handlers} />);
  return handlers;
}
const finding = (rule: string) => screen.getByText(rule).closest("li")!;

afterEach(cleanup);

describe("Drift tab (workbench-ui/R6)", () => {
  it("groups findings by feature and requirement, with rule, message, file and commit", () => {
    show(state());
    expect(screen.getByRole("status").textContent).toBe("2 findings");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("auth");
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["R1: Sign in", "R2: Lockout"]);
    const c = within(finding("drift/code-changed-since-spec"));
    expect(c.getByText(changed.message)).toBeTruthy();
    expect(c.getByText("src/login.ts")).toBeTruthy();
    expect(c.getByRole("button", { name: 'Show abc1234 "fix: reject empty passwords"' })).toBeTruthy();
    expect(within(finding("drift/unimplemented")).queryByRole("button", { name: /^Show/ })).toBeNull();
  });

  it("shows a finding's commit diff inline, and hides it again", () => {
    const diffs = diffSource();
    show(state(), diffs);
    const button = within(finding("drift/code-changed-since-spec")).getByRole("button", { name: /^Show abc1234/ });
    fireEvent.click(button);
    expect(diffs.requests.at(-1)).toEqual({ source: "commit", root: "/repo", commit: "abc1234def" });
    expect(screen.getByRole("region", { name: "Diff of commit abc1234" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Diff of added.txt" })).toBeTruthy();
    fireEvent.click(within(finding("drift/code-changed-since-spec")).getByRole("button", { name: /^Hide abc1234/ }));
    expect(screen.queryByRole("region", { name: /^Diff of commit/ })).toBeNull();
  });

  it("acknowledges a finding and opens its requirement", () => {
    const { onAck, onOpen } = show(state());
    fireEvent.click(within(finding("drift/code-changed-since-spec")).getByRole("button", { name: "Acknowledge" }));
    expect(onAck).toHaveBeenCalledWith("/repo", changed);
    fireEvent.click(within(finding("drift/unimplemented")).getByRole("button", { name: "Acknowledge" }));
    expect(onAck).toHaveBeenLastCalledWith("/repo", unimplemented);
    fireEvent.click(screen.getByRole("button", { name: "R1: Sign in" }));
    expect(onOpen).toHaveBeenCalledWith("/repo", "auth", "R1");
  });

  it("says drift was not checked rather than showing an empty list, and checks it", () => {
    const { onCheck } = show(state({ roots: [root({ drift: { checked: false } })] }));
    expect(screen.getByRole("status").textContent).toBe("Drift not checked yet.");
    expect(screen.queryByRole("listitem")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check drift" }));
    expect(onCheck).toHaveBeenCalledOnce();
  });

  it("shows progress while a check runs", () => {
    const { onCheck } = show(state({ driftChecking: true }));
    const button = screen.getByRole("button", { name: "Checking…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Checking drift…");
    fireEvent.click(button);
    expect(onCheck).not.toHaveBeenCalled();
  });

  it("says when there is no drift, or the history could not be read", () => {
    show(state({ roots: [root({ drift: { checked: true, findings: [] } })] }));
    expect(screen.getByRole("status").textContent).toBe("No drift found.");
    cleanup();
    show(state({ roots: [root({ historyError: "not a git repository" })] }));
    expect(screen.getByRole("alert").textContent).toBe("Could not read the history: not a git repository");
  });
});
