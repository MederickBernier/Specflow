// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./app.tsx";
import type { PageState, WebviewApi } from "./vscode-api.ts";

function fakeApi(state?: PageState): WebviewApi & { state: PageState | undefined; posted: unknown[] } {
  return {
    state,
    posted: [],
    postMessage(message) {
      this.posted.push(message);
    },
    getState() {
      return this.state;
    },
    setState(next) {
      this.state = next;
    },
  };
}

const selected = () => screen.getByRole("tab", { selected: true });

afterEach(cleanup);

describe("workbench page (workbench-ui/R1)", () => {
  it("shows the five tabs, Overview first", () => {
    render(<App api={fakeApi()} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Overview", "Board", "Review", "Trace", "Drift"]);
    expect(selected().textContent).toBe("Overview");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("tab-overview");
  });

  it("switches tab on click and saves it", () => {
    const api = fakeApi();
    render(<App api={api} />);
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    expect(selected().textContent).toBe("Review");
    expect(screen.getByRole("heading").textContent).toBe("Review");
    expect(api.state).toEqual({ tab: "review" });
  });

  it("tells the host which tab it shows", () => {
    const api = fakeApi();
    render(<App api={api} />);
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(api.posted).toEqual([
      { type: "tab", tab: "overview" },
      { type: "tab", tab: "board" },
    ]);
  });

  it("comes back on the saved tab, ahead of the host's hint", () => {
    render(<App api={fakeApi({ tab: "trace" })} initialTab="board" />);
    expect(selected().textContent).toBe("Trace");
  });

  it("starts on the host's hint when nothing was saved", () => {
    render(<App api={fakeApi()} initialTab="drift" />);
    expect(selected().textContent).toBe("Drift");
  });

  it("ignores a saved tab that no longer exists", () => {
    render(<App api={fakeApi({ tab: "settings" as never })} />);
    expect(selected().textContent).toBe("Overview");
  });

  it("switches tab when the host asks", async () => {
    const api = fakeApi();
    render(<App api={api} />);
    window.dispatchEvent(new MessageEvent("message", { data: { type: "show", tab: "board" } }));
    await screen.findByRole("heading", { name: "Board" });
    expect(api.state).toEqual({ tab: "board" });
    window.dispatchEvent(new MessageEvent("message", { data: { type: "show", tab: "nope" } }));
    window.dispatchEvent(new MessageEvent("message", { data: null }));
    expect(selected().textContent).toBe("Board");
  });

  // workbench-ui/R2: a feature on the Overview opens the Board filtered to it, and the filter is saved.
  it("opens the Board on a feature picked in the Overview", () => {
    const api = fakeApi();
    const state = {
      revision: 1,
      harness: { state: "unknown" as const },
      roots: [{ root: "/repo", name: "repo", lintProblems: 0, drift: { checked: false as const }, features: [{ name: "auth", requirements: [], tasks: [] }] }],
    };
    render(<App api={api} state={state} />);
    fireEvent.click(screen.getByRole("button", { name: /^auth:/ }));
    expect(selected().textContent).toBe("Board");
    expect(api.state).toEqual({ tab: "board", filter: { root: "/repo", feature: "auth" } });
  });

  it("forgets the Board filter when All features is picked", () => {
    const api = fakeApi({ tab: "board", filter: { root: "/repo", feature: "auth" } });
    const state = {
      revision: 1,
      harness: { state: "unknown" as const },
      roots: [{ root: "/repo", name: "repo", lintProblems: 0, drift: { checked: false as const }, features: [{ name: "auth", requirements: [], tasks: [] }] }],
    };
    render(<App api={api} state={state} />);
    const select = screen.getByRole("combobox", { name: "Feature" }) as HTMLSelectElement;
    expect(select.value).not.toBe("");
    select.value = "";
    fireEvent.change(select);
    expect(api.state).toEqual({ tab: "board" });
  });

  it("moves between tabs with the keyboard, keeping one tab in the tab order", () => {
    render(<App api={fakeApi()} />);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(selected().textContent).toBe("Board");
    expect(document.activeElement).toBe(selected());
    fireEvent.keyDown(tablist, { key: "End" });
    expect(selected().textContent).toBe("Drift");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(selected().textContent).toBe("Overview");
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(selected().textContent).toBe("Drift");
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(selected().textContent).toBe("Overview");
    expect(screen.getAllByRole("tab").map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });
});
