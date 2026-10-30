import { SUBAGENT_TITLE, taskEnded } from "@nyte-ai/plugin/client/presentation";
import { asId } from "@nyte-ai/schema";
import type { TaskState } from "@nyte-ai/plugin/client/presentation";
import type { BackgroundItem, CallId, JobId, JobView, SessionId, ToolClass } from "@nyte-ai/sdk";
import type { Chat } from "./directory.ts";

export type Task = ChildTask | JobTask;

export interface ChildTask {
  readonly kind: "child";
  readonly id: SessionId;
  readonly title: string;
  readonly state: TaskState;
  readonly startedBy: CallId | null;
  /** Its own run is going, so a stop has something to stop. */
  readonly live: boolean;
}

export interface JobTask {
  readonly kind: "job";
  readonly id: JobId;
  readonly title: string;
  readonly state: TaskState;
  readonly startedBy: CallId | null;
  /** The job as its workspace lists it: undefined while the list loads, null once the host no longer keeps the job or its output. */
  readonly job: JobView | null | undefined;
  readonly live: boolean;
}

export type TaskKey =
  | { readonly kind: BackgroundItem["kind"]; readonly call: CallId }
  | { readonly kind: BackgroundItem["kind"]; readonly id: string };

export function delegateKey(
  toolClass: Extract<ToolClass, { readonly kind: "delegate" }>,
  call: CallId,
): TaskKey {
  return toolClass.child === null
    ? { kind: "child", call }
    : { kind: "child", id: toolClass.child };
}

export function matchesKey(
  entry: Pick<BackgroundItem, "id" | "startedBy"> & { readonly kind: string },
  key: TaskKey,
): boolean {
  return (
    entry.kind === key.kind && ("call" in key ? entry.startedBy === key.call : entry.id === key.id)
  );
}

export function findTask(tasks: readonly Task[], key: TaskKey): Task | undefined {
  return tasks.find((task) => matchesKey(task, key));
}

export function childTitle(chat: Chat | undefined, delegated: string | null = null): string {
  return chat?.title ?? delegated ?? SUBAGENT_TITLE;
}

export function describeTask(
  item: BackgroundItem,
  chat: Chat | undefined,
  jobs: readonly JobView[] | undefined,
): Task | undefined {
  switch (item.kind) {
    case "child":
      return childTask(asId<"session">(item.id), chat, item);
    case "job": {
      const job =
        jobs === undefined ? undefined : (jobs.find((entry) => entry.id === item.id) ?? null);

      return {
        kind: "job",
        id: asId<"job">(item.id),
        title: item.title,
        state: item.state,
        startedBy: item.startedBy,
        job,
        live: job?.state.kind === "running",
      };
    }

    case "page":
      return undefined;
    default: {
      const _exhaustive: never = item.kind;

      return _exhaustive;
    }
  }
}

/**
 * How it stands and which call started it come from its background item, not its chat, so every
 * row of the parent agrees while the child's chat lags.
 */
export function childTask(
  id: SessionId,
  chat: Chat | undefined,
  item: BackgroundItem | undefined,
): ChildTask {
  return {
    kind: "child",
    id,
    title: childTitle(chat, item?.title ?? null),
    state: item === undefined ? (chat?.mark ?? "done") : childState(item.state, chat?.mark),
    startedBy: item?.startedBy ?? null,
    live: chat !== undefined && "run" in chat.status,
  };
}

function childState(state: BackgroundItem["state"], mark: TaskState | undefined): TaskState {
  if (state === "working" && mark === "retrying") return mark;

  if (state === "done" && mark === "background") return mark;

  return state;
}

export function trayTasks<T extends Task>(
  tasks: readonly T[],
  cleared: ReadonlySet<string>,
): readonly T[] {
  return tasks
    .flatMap((task, index) =>
      taskEnded(task.state) && cleared.has(task.id) ? [] : [{ task, index }],
    )
    .toSorted(
      (left, right) => rank(left.task.state) - rank(right.task.state) || right.index - left.index,
    )
    .map((entry) => entry.task);
}

function rank(state: TaskState): number {
  if (state === "waiting") return 0;

  return taskEnded(state) ? 2 : 1;
}
