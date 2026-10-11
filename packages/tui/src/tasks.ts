/** Task rows: the session's child agents with their full transcripts, and its command jobs. */
import type {
  Connection,
  Execution,
  JobView,
  SessionId,
  SessionInfo,
  SessionView,
} from "@nyte-ai/sdk";
import { GLYPHS } from "./constants.ts";
import { userText } from "./format.ts";
import { toolTitle } from "./tool-copy.ts";
import { follow, isTextMessage, isToolMessage, toolStatus } from "./view-helpers.ts";
import type { ToolTone } from "./view-helpers.ts";

export type Task =
  | {
      readonly kind: "agent";
      readonly id: SessionId;
      readonly info: SessionInfo;
      /** The child's main head, once its watch has yielded. */
      readonly view: SessionView | undefined;
    }
  | { readonly kind: "job"; readonly id: string; readonly job: JobView };

type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "retrying"
  | "stopping"
  | "stopped"
  | "done"
  | "failed";

/**
 * How a status looks, everywhere it is shown: a glyph and the theme role that
 * colors it. Cancellation the user asked for stays muted; the states a
 * participant can act on (waiting, retrying) take the warning role.
 */
interface StatusMark {
  readonly glyph: string;
  readonly tone: "muted" | "running" | "warning" | "ok" | "error";
}

export function statusMark(status: TaskStatus): StatusMark {
  switch (status) {
    case "queued":
      return { glyph: GLYPHS.diamond, tone: "muted" };
    case "running":
      return { glyph: GLYPHS.bullet, tone: "running" };
    case "waiting":
    case "retrying":
      return { glyph: GLYPHS.bullet, tone: "warning" };
    case "stopping":
      return { glyph: GLYPHS.bullet, tone: "muted" };
    case "stopped":
      return { glyph: GLYPHS.cross, tone: "muted" };
    case "done":
      return { glyph: GLYPHS.check, tone: "ok" };
    case "failed":
      return { glyph: GLYPHS.cross, tone: "error" };
    default: {
      const _exhaustive: never = status;

      return _exhaustive;
    }
  }
}

/** The child's main head execution: the view's when it has one, else the directory row's. */
function agentExecution(task: Extract<Task, { kind: "agent" }>): Execution | undefined {
  return task.view?.execution ?? task.info.heads.find((head) => head.name === "main")?.execution;
}

export function taskStatus(task: Task): TaskStatus {
  if (task.kind === "agent") return executionStatus(agentExecution(task));
  const { state } = task.job;

  switch (state.kind) {
    case "running":
      return "running";
    case "exited":
      return state.reason === "exited" ? (state.code === 0 ? "done" : "failed") : "stopped";
    case "lost":
      return "stopped";
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

/** A tool call's tone in the task vocabulary, so one mark draws both. */
export function toneStatus(tone: ToolTone): TaskStatus {
  switch (tone) {
    case "running":
      return "running";
    case "attention":
      return "waiting";
    case "success":
      return "done";
    case "failure":
      return "failed";
    case "stopped":
      return "stopped";
    default: {
      const _exhaustive: never = tone;

      return _exhaustive;
    }
  }
}

function executionStatus(execution: Execution | undefined): TaskStatus {
  if (execution === undefined) return "queued";

  switch (execution.kind) {
    case "idle": {
      const end = execution.lastRun?.end;

      if (end === undefined) return "queued";

      return end.kind === "completed" ? "done" : end.kind === "stopped" ? "stopped" : "failed";
    }

    case "live":
      return execution.stopping ? "stopping" : "running";
    case "waiting":
      return "waiting";
    case "retrying":
      return "retrying";
    default: {
      const _exhaustive: never = execution;

      return _exhaustive;
    }
  }
}

export function canStopTask(task: Task): boolean {
  if (task.kind === "job") return task.job.state.kind === "running";
  const execution = agentExecution(task);

  if (execution === undefined || execution.kind === "idle") return false;

  return execution.kind !== "live" || !execution.stopping;
}

/** Whether the task runs a child session or a command. */
export function taskAgent(task: Task): string {
  return task.kind === "agent" ? "subagent" : "command";
}

export function taskLabel(task: Task): string {
  if (task.kind === "job") return task.job.title === "" ? task.job.command : task.job.title;

  return task.info.name ?? (task.view === undefined ? undefined : taskPrompt(task.view)) ?? task.id;
}

/** The model and thinking level a child resolves to, for its card and row. */
export function taskConfiguration(task: Extract<Task, { kind: "agent" }>): string {
  const effective = task.view?.configuration.effective;

  return effective === null || effective === undefined
    ? ""
    : `${effective.model.id} · ${effective.thinking}`;
}

/** What a child was asked to do: its first user message. */
export function taskPrompt(view: SessionView): string | undefined {
  const user = view.messages.find((message) => message.kind === "user");

  return user?.kind === "user" ? oneLine(userText(user.content)) : undefined;
}

function oneLine(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

export function taskActivity(task: Task): string {
  if (task.kind === "job") return oneLine(task.job.tail.trimEnd().split("\n").at(-1) ?? "");
  const execution = agentExecution(task);

  if (execution?.kind === "retrying") return execution.reason;

  if (execution?.kind === "idle" && execution.lastRun?.end.kind === "failed")
    return execution.lastRun.end.failure.message;

  return task.view === undefined ? "" : (taskSteps(task.view).at(-1)?.text ?? "");
}

interface TaskStep {
  readonly status: TaskStatus;
  readonly text: string;
}

/**
 * What a child did, oldest first: each tool call and each answer. Thinking
 * is not a step; a running call shows its progress line.
 */
export function taskSteps(view: SessionView): TaskStep[] {
  const steps: TaskStep[] = [];

  for (const message of view.messages) {
    if (message.kind !== "part") continue;

    if (isToolMessage(message)) {
      const status = toolStatus(message.state, message.status);
      const progress = message.state.phase === "running" ? message.state.progress?.text : undefined;
      const title = toolTitle(message.state.class, status.tense);

      steps.push({
        status: toneStatus(status.tone),
        text: oneLine(
          progress !== undefined && progress !== ""
            ? progress
            : status.word === undefined
              ? title
              : `${title} · ${status.word.toLowerCase()}`,
        ),
      });
    } else if (isTextMessage(message) && message.state.markdown !== "") {
      steps.push({
        status: message.status.kind === "settled" ? "done" : "running",
        text: oneLine(message.state.markdown),
      });
    }
  }

  return steps;
}

/** Time on the task so far, or the time it took. */
export function taskElapsedMs(task: Task, now: number): number | undefined {
  if (task.kind === "job") return (task.job.endedAt ?? now) - task.job.startedAt;
  const execution = agentExecution(task);

  if (execution !== undefined && execution.kind !== "idle") return now - execution.run.startedAt;
  const last = task.view?.turns.at(-1);

  return last?.endedAt === null || last === undefined ? undefined : last.endedAt - last.startedAt;
}

export function unfinishedTask(task: Task): boolean {
  return !["done", "failed", "stopped"].includes(taskStatus(task));
}

/** One child the index follows: its directory row, its latest view, and how to stop following it. */
interface Child {
  info: SessionInfo;
  view: SessionView | undefined;
  stop: () => void;
}

interface TaskIndexOptions {
  readonly connection: Connection;
  readonly onChange: () => void;
  readonly onError: (error: unknown) => void;
}

/**
 * The tasks of one session: its children from the directory, each followed by
 * its own view, and the jobs of its workspace that report to it.
 */
export class TaskIndex {
  private readonly options: TaskIndexOptions;
  private readonly children = new Map<SessionId, Child>();
  private jobs: readonly JobView[] = [];
  private readonly stops: (() => void)[] = [];

  constructor(session: SessionInfo, options: TaskIndexOptions) {
    this.options = options;
    const { connection } = options;

    this.stops.push(
      follow(
        connection.sessions.watch({ parents: { kind: "children", session: session.id } }),
        (children) => this.syncChildren(children),
        options.onError,
      ),
      follow(
        connection.workspace(session.workspace).jobs.watch(),
        (jobs) => {
          this.jobs = jobs.filter((job) => job.session === session.id);
          options.onChange();
        },
        options.onError,
      ),
    );
  }

  get tasks(): readonly Task[] {
    return [
      ...[...this.children.values()]
        .toSorted((left, right) => left.info.createdAt - right.info.createdAt)
        .map((child): Task => ({
          kind: "agent",
          id: child.info.id,
          info: child.info,
          view: child.view,
        })),
      ...this.jobs.map((job): Task => ({ kind: "job", id: job.id, job })),
    ];
  }

  close(): void {
    for (const stop of this.stops.splice(0)) stop();

    for (const child of this.children.values()) child.stop();
    this.children.clear();
  }

  private syncChildren(children: readonly SessionInfo[]): void {
    const listed = new Set(children.map((info) => info.id));

    for (const [id, child] of this.children) {
      if (listed.has(id)) continue;
      child.stop();
      this.children.delete(id);
    }

    for (const info of children) {
      const known = this.children.get(info.id);

      if (known !== undefined) {
        known.info = info;
        continue;
      }

      const entry: Child = { info, view: undefined, stop: () => undefined };

      this.children.set(info.id, entry);
      entry.stop = follow(
        this.options.connection.session(info.id).watch(),
        (view) => {
          entry.view = view;
          this.options.onChange();
        },
        this.options.onError,
      );
    }

    this.options.onChange();
  }
}
