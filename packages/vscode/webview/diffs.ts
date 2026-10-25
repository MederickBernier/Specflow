import { useEffect, useRef, useState } from "preact/hooks";
import type { DiffAnswer, DiffRequest, HostMessage } from "../src/workbench/protocol.ts";
import type { WebviewApi } from "./vscode-api.ts";

/** The cache key of a diff request. */
export function diffKey(request: DiffRequest): string {
  return JSON.stringify([request.source, request.root, request.path ?? null, request.commit ?? null]);
}

/** Looks up a diff, asking the extension for it the first time; undefined while it loads. */
export type DiffSource = (request: DiffRequest) => DiffAnswer | undefined;

/**
 * Diffs the page asked for, cached until the state changes (workbench-ui/R4,
 * R5). Each request carries the state revision; answers for an older one are
 * dropped, so an edit made while a diff loads never leaves a stale diff.
 */
export function useDiffs(api: WebviewApi, revision: number | undefined): DiffSource {
  const [answers, setAnswers] = useState<Map<string, DiffAnswer>>(new Map());
  const asked = useRef<Set<string>>(new Set());
  const current = useRef(revision);

  if (current.current !== revision) {
    current.current = revision;
    asked.current = new Set();
  }

  useEffect(() => {
    setAnswers(new Map());
  }, [revision]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as HostMessage | undefined;
      if (message?.type !== "diff" || message.revision !== current.current) return;
      setAnswers((previous) => new Map(previous).set(diffKey(message), message));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (request) => {
    if (revision === undefined) return undefined;
    const key = diffKey(request);
    const answer = answers.get(key);
    if (answer && answer.revision === revision) return answer;
    if (!asked.current.has(key)) {
      asked.current.add(key);
      // Ask after rendering, never during it.
      queueMicrotask(() => api.postMessage({ type: "diff", ...request, revision }));
    }
    return undefined;
  };
}
