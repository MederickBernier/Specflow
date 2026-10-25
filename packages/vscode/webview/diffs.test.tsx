// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import type { DiffAnswer, DiffRequest } from "../src/workbench/protocol.ts";
import { useDiffs } from "./diffs.ts";
import type { WebviewApi } from "./vscode-api.ts";

const request: DiffRequest = { source: "working", root: "/repo" };
const answer = (revision: number, path = "a.txt"): DiffAnswer => ({
  ...request,
  revision,
  truncated: false,
  files: [{ path, change: "modified", binary: false, additions: 1, deletions: 0, hunks: [] }],
});

function Probe({ api, revision }: { api: WebviewApi; revision: number }) {
  const diffs = useDiffs(api, revision);
  const found = diffs(request);
  return <p>{found && "files" in found ? found.files.map((f) => f.path).join(",") : "loading"}</p>;
}

const fakeApi = () => {
  const posted: unknown[] = [];
  return { posted, postMessage: (m: unknown) => posted.push(m), getState: () => undefined, setState: () => {} } satisfies WebviewApi & { posted: unknown[] };
};
const answerWith = (data: unknown) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

afterEach(cleanup);

describe("useDiffs (workbench-ui/R4, R5)", () => {
  it("asks once per request and revision, then shows the answer", async () => {
    const api = fakeApi();
    const { rerender } = render(<Probe api={api} revision={4} />);
    rerender(<Probe api={api} revision={4} />);
    await flush();
    expect(api.posted).toEqual([{ type: "diff", source: "working", root: "/repo", revision: 4 }]);
    expect(screen.getByText("loading")).toBeTruthy();
    await answerWith({ type: "diff", ...answer(4) });
    expect(screen.getByText("a.txt")).toBeTruthy();
  });

  it("drops answers for an older revision and asks again after the state changes", async () => {
    const api = fakeApi();
    const { rerender } = render(<Probe api={api} revision={4} />);
    await flush();
    await answerWith({ type: "diff", ...answer(4) });
    rerender(<Probe api={api} revision={5} />);
    await flush();
    expect(screen.getByText("loading")).toBeTruthy();
    expect(api.posted.at(-1)).toEqual({ type: "diff", source: "working", root: "/repo", revision: 5 });
    await answerWith({ type: "diff", ...answer(4, "stale.txt") });
    expect(screen.getByText("loading")).toBeTruthy();
    await answerWith({ type: "diff", ...answer(5, "fresh.txt") });
    expect(screen.getByText("fresh.txt")).toBeTruthy();
  });

  it("ignores other messages", async () => {
    const api = fakeApi();
    render(<Probe api={api} revision={1} />);
    await answerWith({ type: "state" });
    await answerWith(null);
    expect(screen.getByText("loading")).toBeTruthy();
  });
});
