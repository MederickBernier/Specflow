import { type AdapterRegistry, type Clock, type Git, type RunTaskResult, runTask, type SpecTree } from "@specflow/core";
import * as vscode from "vscode";
import { checkHarness, harnessOverride } from "../harness-health.js";
import type { VsCodeFileSystem } from "../vscode-fs.js";
import { cancelling, confirmationDetail, initialState, reduce, type RunViewState, withOutcome } from "./run-view-model.js";
import { RunView } from "./run-view.js";

/** A run in progress or finished, as tests and later features see it. */
export type ActiveRun = {
  target: string;
  state: RunViewState;
  cancel: () => void;
  done: Promise<RunTaskResult | undefined>;
};

/** Runs tasks from the editor: confirm, run through core's runTask, stream into a RunView (vscode-extension/R4). */
export class RunController implements vscode.Disposable {
  readonly #deps: { fs: VsCodeFileSystem; git: Git; registry: AdapterRegistry; clock: Clock };
  #current: ActiveRun | undefined;
  readonly #views: RunView[] = [];
  readonly #changed = new vscode.EventEmitter<void>();
  /** Fires when the latest run starts or its state changes. */
  readonly onDidChange = this.#changed.event;

  constructor(deps: { fs: VsCodeFileSystem; git: Git; registry: AdapterRegistry; clock: Clock }) {
    this.#deps = deps;
  }

  /** The latest run. */
  get current(): ActiveRun | undefined {
    return this.#current;
  }

  /**
   * Runs `feature/task` in `tree`. Resolves when the run finished, or with
   * undefined when the user declined or a check failed.
   */
  async run(tree: SpecTree, feature: string, task: string): Promise<RunTaskResult | undefined> {
    if (this.#current && isRunning(this.#current.state)) {
      void vscode.window.showWarningMessage(`Specflow: ${this.#current.target} is still running. Cancel it first.`);
      return undefined;
    }
    const target = `${feature}/${task}`;
    const health = await checkHarness(this.#deps.registry, tree.config, { quiet: true });
    if (!health.ready) return undefined;

    if (vscode.workspace.getConfiguration("specflow").get<boolean>("confirmRuns", true)) {
      const choice = await vscode.window.showInformationMessage(
        confirmationDetail(target, health.harness!, tree.config.commit.mode),
        { modal: true },
        "Run",
      );
      if (choice !== "Run") return undefined;
    }

    let allowDirty = false;
    for (;;) {
      const outcome = await this.#start(tree, feature, task, allowDirty);
      if (outcome.kind !== "dirty") return outcome.result;
      const choice = await vscode.window.showWarningMessage(outcome.message, { modal: true }, "Run anyway");
      if (choice !== "Run anyway") return undefined;
      allowDirty = true;
    }
  }

  /** Cancels the current run, if any. */
  cancel(): void {
    this.#current?.cancel();
  }

  dispose(): void {
    this.cancel();
    for (const view of this.#views) view.dispose();
    this.#changed.dispose();
  }

  async #start(
    tree: SpecTree,
    feature: string,
    task: string,
    allowDirty: boolean,
  ): Promise<{ kind: "done"; result: RunTaskResult | undefined } | { kind: "dirty"; message: string }> {
    const target = `${feature}/${task}`;
    const controller = new AbortController();
    let view: RunView | undefined;
    const run: ActiveRun = {
      target,
      state: initialState(target),
      cancel: () => {
        run.state = cancelling(run.state);
        view?.update(run.state);
        if (this.#current === run) this.#changed.fire();
        controller.abort();
      },
      done: Promise.resolve(undefined),
    };
    const update = (state: RunViewState) => {
      run.state = state;
      view?.update(state);
      if (this.#current === run) this.#changed.fire();
    };

    const pending = runTask(
      this.#deps,
      tree,
      { feature, task, allowDirty, ...(harnessOverride() && { harness: harnessOverride() }) },
      controller.signal,
      {
        onStarted: ({ harness, warnings }) => {
          this.#current = run;
          view = new RunView(run.state);
          this.#views.push(view);
          view.onDidRequestCancel(() => run.cancel());
          update({ ...run.state, harness, lines: warnings.map((text) => ({ kind: "warning", text })) });
        },
        onEvent: (event) => update(reduce(run.state, event)),
      },
    );
    run.done = pending.then((r) => (r.ok ? r.value : undefined));

    const result = await pending;
    if (!result.ok) {
      if (result.error.kind === "dirty-tree") return { kind: "dirty", message: result.error.message };
      void vscode.window.showErrorMessage(`Specflow: ${result.error.message}`);
      return { kind: "done", result: undefined };
    }
    update(withOutcome(run.state, result.value));
    return { kind: "done", result: result.value };
  }
}

function isRunning(state: RunViewState): boolean {
  return state.status === "starting" || state.status === "running" || state.status === "cancelling";
}
