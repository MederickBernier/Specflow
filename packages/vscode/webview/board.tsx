import type { TaskView, WorkbenchState } from "../src/workbench/protocol.ts";
import type { FeatureRef } from "./overview.tsx";

/** A task on the board, with where it lives. */
export type TaskRef = { root: string; feature: string; task: string };

const columns: { status: TaskView["status"]; title: string; icon: string }[] = [
  { status: "todo", title: "To do", icon: "circle-large-outline" },
  { status: "doing", title: "Doing", icon: "sync" },
  { status: "done", title: "Done", icon: "pass" },
  { status: "blocked", title: "Blocked", icon: "circle-slash" },
];

type Card = TaskView & { root: string; feature: string };

/** Why tasks cannot be run right now, if they cannot: one run at a time, and none while one is under review. */
export function runBlocker(state: WorkbenchState): string | undefined {
  const run = state.run;
  if (run && (run.status === "starting" || run.status === "running" || run.status === "cancelling")) return `${run.target} is running`;
  if (state.review) return `Accept or discard ${state.review.target} first`;
  return undefined;
}

/**
 * The Board tab (workbench-ui/R3): one column per task status, a card per
 * task with its requirements and dependencies, marked when it waits on
 * dependencies that are not done. Run goes through `Specflow: Run task`, so
 * the confirmation and checks are the same; Open shows the task's heading.
 * Status is not changed here: runs own the status line.
 */
export function Board({
  state,
  filter,
  onFilter,
  onRun,
  onOpen,
}: {
  state: WorkbenchState;
  filter?: FeatureRef;
  onFilter: (filter: FeatureRef | undefined) => void;
  onRun: (task: TaskRef) => void;
  onOpen: (task: TaskRef) => void;
}) {
  const features = state.roots.flatMap((root) => root.features.map((feature) => ({ root, feature })));
  const active = filter && features.some((f) => f.root.root === filter.root && f.feature.name === filter.feature) ? filter : undefined;
  const several = state.roots.length > 1;
  const cards: Card[] = features
    .filter((f) => !active || (f.root.root === active.root && f.feature.name === active.feature))
    .flatMap((f) => f.feature.tasks.map((t) => ({ ...t, root: f.root.root, feature: f.feature.name })));
  const blocker = runBlocker(state);
  const key = (root: string, feature: string) => JSON.stringify([root, feature]);

  return (
    <div class="board">
      <div class="board-toolbar">
        <label>
          Feature{" "}
          <select
            value={active ? key(active.root, active.feature) : ""}
            onChange={(event) => {
              const value = (event.currentTarget as HTMLSelectElement).value;
              if (!value) return onFilter(undefined);
              const [root, feature] = JSON.parse(value) as [string, string];
              onFilter({ root, feature });
            }}
          >
            <option value="">All features</option>
            {features.map(({ root, feature }) => (
              <option key={key(root.root, feature.name)} value={key(root.root, feature.name)}>
                {several ? `${root.name} / ${feature.name}` : feature.name}
              </option>
            ))}
          </select>
        </label>
        {blocker && (
          <span class="muted" role="status">
            <span class="codicon codicon-info" aria-hidden="true" /> {blocker}
          </span>
        )}
      </div>
      {features.length === 0 ? (
        <p class="empty">No tasks yet.</p>
      ) : (
        <div class="columns">
          {columns.map((column) => {
            const inColumn = cards.filter((c) => c.status === column.status);
            return (
              <section key={column.status} class={`column ${column.status}`} aria-labelledby={`column-${column.status}`}>
                <h2 id={`column-${column.status}`}>
                  <span class={`codicon codicon-${column.icon}`} aria-hidden="true" /> {column.title} <span class="muted">{inColumn.length}</span>
                </h2>
                <ul>
                  {inColumn.map((card) => (
                    <li key={`${card.root}\u0000${card.feature}\u0000${card.id}`}>
                      <TaskCard card={card} showFeature={!active} {...(blocker && { blocker })} onRun={onRun} onOpen={onOpen} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskCard({
  card,
  showFeature,
  blocker,
  onRun,
  onOpen,
}: {
  card: Card;
  showFeature: boolean;
  blocker?: string;
  onRun: (task: TaskRef) => void;
  onOpen: (task: TaskRef) => void;
}) {
  const ref = { root: card.root, feature: card.feature, task: card.id };
  const name = `${card.feature}/${card.id}`;
  return (
    <article class="task-card" aria-label={`${name}: ${card.title}`}>
      <header>
        <span class="task-id">{card.id}</span>
        {showFeature && <span class="chip">{card.feature}</span>}
      </header>
      <span class="task-title">{card.title}</span>
      {card.reqs.length > 0 && <span class="muted">{card.reqs.join(", ")}</span>}
      {card.depends.length > 0 && <span class="muted">Depends on {card.depends.join(", ")}</span>}
      {card.waitingOn.length > 0 && card.status !== "done" && (
        <span class="waiting">
          <span class="codicon codicon-watch" aria-hidden="true" /> Waiting on {card.waitingOn.join(", ")}
        </span>
      )}
      <div class="card-actions">
        <button
          type="button"
          class="primary"
          disabled={blocker !== undefined}
          title={blocker ?? `Run ${name}`}
          aria-label={`${card.status === "done" ? "Run again" : "Run"} ${name}`}
          onClick={() => onRun(ref)}
        >
          <span class="codicon codicon-play" aria-hidden="true" /> {card.status === "done" ? "Run again" : "Run"}
        </button>
        <button type="button" class="secondary" aria-label={`Open ${name}`} onClick={() => onOpen(ref)}>
          Open
        </button>
      </div>
    </article>
  );
}
