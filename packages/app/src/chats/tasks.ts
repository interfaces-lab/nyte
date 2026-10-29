import { rowMark, SUBAGENT_TITLE, taskEnded } from "@nyte-ai/plugin/client/presentation";
import { asId } from "@nyte-ai/schema";
import type { TaskState } from "@nyte-ai/plugin/client/presentation";
import type { BackgroundItem, CallId, JobId, JobView, SessionId, ToolClass } from "@nyte-ai/sdk";
import type { Chat } from "./directory.ts";

/** Work a chat started, as the host lists it in the chat's background: a subagent or a job. */
export type Task = ChildTask | JobTask;

export interface ChildTask {
  readonly kind: "child";
  readonly id: SessionId;
  readonly title: string;
  readonly state: TaskState;
  /** The call that started it; null for one started another way. */
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

/** Which background item a row speaks of: the one its call started, or the one it names. */
export type TaskKey =
  | { readonly kind: BackgroundItem["kind"]; readonly call: CallId }
  | { readonly kind: BackgroundItem["kind"]; readonly id: string };

/** The child a delegate call speaks of: the one it names, else the one it started. */
export function delegateKey(
  toolClass: Extract<ToolClass, { readonly kind: "delegate" }>,
  call: CallId,
): TaskKey {
  return toolClass.child === null
    ? { kind: "child", call }
    : { kind: "child", id: toolClass.child };
}

/** Whether a background item or a task is the one `key` picks: one join for every row. */
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

/** What a surface calls a child chat: its chat's title; before the directory lists it, the title its delegate call or the host gave it. */
export function childTitle(chat: Chat | undefined, delegated: string | null = null): string {
  return chat?.title ?? delegated ?? SUBAGENT_TITLE;
}

/**
 * A background item as a task. A subagent reads from its chat, which has its own run, retries and
 * pending renames; a job reads from the workspace's job list. A held page is not a task.
 */
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

/** A child chat as a task: its background item gives the call that started it, its chat the rest. */
export function childTask(
  id: SessionId,
  chat: Chat | undefined,
  item: BackgroundItem | undefined,
): ChildTask {
  return {
    kind: "child",
    id,
    title: childTitle(chat, item?.title ?? null),
    state: chat === undefined ? (item?.state ?? "done") : rowMark(chat.status, chat.background),
    startedBy: item?.startedBy ?? null,
    live: chat !== undefined && "run" in chat.status,
  };
}

/**
 * The tasks a tray lists: every one still going, and each ended one until the user clears it.
 * Those waiting on the user come first, then those still going, then ended ones, newest first.
 */
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
