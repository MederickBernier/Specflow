// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkbenchState } from "../src/workbench/protocol.ts";
import { Connected } from "./connection.tsx";
import type { PageState, WebviewApi } from "./vscode-api.ts";

function fakeApi(): WebviewApi & { posted: unknown[] } {
  let state: PageState | undefined;
  return {
    posted: [],
    postMessage(message) {
      this.posted.push(message);
    },
    getState: () => state,
    setState: (next) => {
      state = next;
    },
  };
}

const state = (revision: number): WorkbenchState => ({ revision, roots: [], harness: { state: "unknown" } });
const post = (data: unknown) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });

afterEach(cleanup);

describe("page connection (workbench-ui/R1)", () => {
  it("asks for the state on load and says it is loading until it comes", () => {
    const api = fakeApi();
    render(<Connected api={api} />);
    expect(api.posted).toContainEqual({ type: "ready" });
    expect(screen.getByText("Loading specs…")).toBeTruthy();
  });

  it("renders each state and reports its revision", async () => {
    const api = fakeApi();
    render(<Connected api={api} />);
    await post({ type: "state", state: state(1) });
    expect(screen.queryByText("Loading specs…")).toBeNull();
    await post({ type: "state", state: state(2) });
    expect(api.posted.filter((m) => (m as { type: string }).type === "rendered")).toEqual([
      { type: "rendered", revision: 1 },
      { type: "rendered", revision: 2 },
    ]);
  });

  it("ignores other messages", async () => {
    const api = fakeApi();
    render(<Connected api={api} />);
    await post({ type: "state" });
    await post(null);
    await post({ type: "unknown", state: state(9) });
    expect(screen.getByText("Loading specs…")).toBeTruthy();
    expect(api.posted.some((m) => (m as { type: string }).type === "rendered")).toBe(false);
  });
});
