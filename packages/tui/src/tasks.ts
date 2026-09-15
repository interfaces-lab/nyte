/** Task rows join session-owned jobs with their full child transcripts. */
import {
  sessionId,
  type JobInfo,
  type Nyte,
  type RunInfo,
  type SessionEvent,
  type SessionId,
  isTerminalPhase,
} from "@nyte-ai/core";
import { GLYPHS } from "./constants.ts";
import { userText } from "./format.ts";
import { isJsonObject, isJsonString } from "./json.ts";
import { SessionObserver } from "@nyte-ai/core/client";
import type { SessionState } from "@nyte-ai/core/client";

export type Task =
  | {
      readonly kind: "agent";
      readonly id: string;
      readonly state: SessionState;
      readonly job?: JobInfo;
    }
  | { readonly kind: "job"; readonly id: string; readonly job: JobInfo };

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
export function statusMark(status: TaskStatus): {
  readonly glyph: string;
  readonly tone: "muted" | "running" | "warning" | "ok" | "error";
} {
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

export function taskStatus(task: Task): TaskStatus {
  if (task.job !== undefined && task.job.state !== "running") {
    return task.job.state === "completed"
      ? "done"
      : task.job.state === "failed"
        ? "failed"
        : "stopped";
  }
  if (task.kind === "job") return "running";
  return runStatus(task.state.run);
}

export function runStatus(run: RunInfo | undefined): TaskStatus {
  if (run === undefined) return "queued";
  switch (run.phase.kind) {
    case "respond":
    case "tools":
      return run.abortRequested ? "stopping" : "running";
    case "waiting":
      return run.abortRequested ? "stopping" : "waiting";
    case "retry":
      return run.abortRequested ? "stopping" : "retrying";
    case "done":
      return "done";
    case "aborted":
      return "stopped";
    case "failed":
      return "failed";
    default: {
      const _exhaustive: never = run.phase;
      return _exhaustive;
    }
  }
}

export function canStopTask(task: Task): boolean {
  if (task.job !== undefined) return task.job.state === "running";
  if (task.kind === "job") return false;
  return (
    task.state.run !== undefined &&
    !isTerminalPhase(task.state.run.phase) &&
    task.state.run.abortRequested !== true
  );
}

/** Whether the task runs a child session or a command. */
export function taskAgent(task: Task): string {
  return task.kind === "agent" ? "subagent" : task.job.kind;
}

export function taskLabel(task: Task): string {
  if (task.kind === "job") return task.job.title;
  if (task.job !== undefined) return task.job.title;
  const info = task.state.info;
  if (info.name !== undefined) return info.name;
  for (const item of task.state.transcript.items) {
    if (item.kind !== "turn") continue;
    const user = item.parts.find((part) => part.kind === "user");
    if (user !== undefined) return oneLine(userText(user.content));
  }
  return info.preview ?? info.sessionId;
}

function oneLine(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

export function taskActivity(task: Task): string {
  if (task.kind === "job") return oneLine(task.job.output);
  const phase = task.state.run?.phase;
  if (phase?.kind === "failed" || phase?.kind === "retry") return phase.error;
  return taskSteps(task.state).at(-1)?.text ?? "";
}

interface TaskStep {
  readonly status: TaskStatus;
  readonly text: string;
}

/**
 * What a child did, oldest first: each tool call and each assistant message.
 * Thinking is not a step. Live progress for a call replaces that call's row,
 * so a running call is never listed twice.
 */
export function taskSteps(state: SessionState): TaskStep[] {
  const steps: TaskStep[] = [];
  const calls = new Map<string, number>();
  for (const item of state.transcript.items) {
    if (item.kind !== "turn") continue;
    for (const part of item.parts) {
      if (part.kind === "tool") {
        calls.set(part.callId, steps.length);
        steps.push({
          status: part.result === undefined ? "running" : part.result.isError ? "failed" : "done",
          text: oneLine(`${part.toolName} ${part.result?.title ?? ""}`),
        });
      } else if (part.kind === "assistant") {
        steps.push({ status: "done", text: oneLine(part.text) });
      }
    }
  }
  for (const part of state.overlay) {
    if (part.kind === "thinking") continue;
    const text = oneLine(
      part.kind === "text" ? part.text : (part.progress.title ?? part.progress.text),
    );
    const index = part.kind === "tool" ? calls.get(part.callId) : undefined;
    if (index !== undefined) {
      if (text !== "") steps[index] = { status: "running", text };
    } else if (text !== "") {
      steps.push({ status: "running", text });
    }
  }
  return steps;
}

/** Time on the task so far, or the time it took. */
export function taskElapsedMs(task: Task, now: number): number | undefined {
  if (task.job !== undefined)
    return (unfinishedTask(task) ? now : task.job.updatedAt) - task.job.startedAt;
  if (task.kind === "job") return undefined;
  if (unfinishedTask(task) && task.state.run !== undefined) return now - task.state.run.startedAt;
  return task.state.transcript.items.findLast((item) => item.kind === "turn")?.durationMs;
}

export function unfinishedTask(task: Task): boolean {
  return task.job === undefined
    ? !["done", "failed", "stopped"].includes(taskStatus(task))
    : task.job.state === "running";
}

export function projectTasks(
  children: readonly SessionState[],
  jobs: readonly JobInfo[] = [],
): Task[] {
  const tasks: Task[] = children.map((state) => {
    const job = jobs.find(
      (candidate) => candidate.kind === "subagent" && candidate.childSessionId === state.sessionId,
    );
    return { kind: "agent", id: job?.id ?? state.sessionId, state, job };
  });
  for (const job of jobs) {
    if (job.kind === "command" && job.mode !== "background") continue;
    if (job.kind === "subagent" && children.some((state) => state.sessionId === job.childSessionId))
      continue;
    tasks.push({ kind: "job", id: job.id, job });
  }
  return tasks;
}

interface TaskIndexOptions {
  readonly nyte: Nyte;
  readonly onChange: () => void;
  readonly onError: (error: Error) => void;
}

/**
 * One observer per child. The task tool's progress names a spawned child only
 * after its setup finished, so that signal follows it directly; the session
 * listing runs only at deliberate boundaries (initial load, reconnect,
 * opening Tasks) to recover children with no live progress. Job events carry
 * the task rows themselves and never open a child mid-setup.
 */
export class TaskIndex {
  private parent: SessionState | undefined;
  private readonly followers = new Map<SessionId, SessionObserver>();
  private readonly children = new Map<SessionId, SessionState>();
  private closed = false;
  private listing = false;
  private dirty = false;

  private readonly options: TaskIndexOptions;

  constructor(options: TaskIndexOptions) {
    this.options = options;
  }

  get states(): readonly SessionState[] {
    if (this.parent === undefined) return [];
    return [...this.children.values()].toSorted(
      (a, b) => a.info.createdAt - b.info.createdAt || a.sessionId.localeCompare(b.sessionId),
    );
  }

  update(state: SessionState, event?: SessionEvent): void {
    if (this.closed) return;
    // TaskBrowser handles parent changes; this index notifies when children change.
    this.parent = state;
    if (
      event?.kind === "tool_progress" &&
      isJsonObject(event.progress.details) &&
      isJsonString(event.progress.details.childSessionId) &&
      // Progress details are tool output; an empty id must not throw here.
      event.progress.details.childSessionId !== ""
    ) {
      void this.follow(sessionId(event.progress.details.childSessionId));
      return;
    }
    if (event === undefined || event.kind === "synced") this.discover();
  }

  /** Look for children the parent links but no job names. A store scan, so boundaries only. */
  discover(): void {
    if (this.closed) return;
    this.dirty = true;
    void this.list();
  }

  close(): void {
    this.closed = true;
    for (const follower of this.followers.values()) follower.close();
    this.followers.clear();
    this.children.clear();
  }

  private async follow(id: SessionId): Promise<void> {
    if (this.closed || this.followers.has(id)) return;
    try {
      // A replayed progress event may name a deleted child, and progress
      // details are tool output: only a session linked to this parent counts.
      const info = await this.options.nyte.sessions.get({ sessionId: id });
      if (info?.parent?.sessionId !== this.parent?.sessionId) return;
      if (this.closed || this.followers.has(id)) return;
      await this.start(id);
    } catch (error) {
      if (!this.closed)
        this.options.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async start(id: SessionId): Promise<void> {
    const observer = new SessionObserver(this.options.nyte, {
      sessionId: id,
      onError: this.options.onError,
    });
    observer.subscribe(({ state }) => {
      if (this.closed || this.followers.get(id) !== observer) return;
      this.children.set(id, state);
      this.options.onChange();
    });
    this.followers.set(id, observer);
    try {
      // Rejects only when the index closed before the first read landed; the caller ignores a closed index.
      await observer.start();
    } catch (error) {
      observer.close();
      this.followers.delete(id);
      throw error;
    }
  }

  private async list(): Promise<void> {
    if (this.listing || this.closed || this.parent === undefined) return;
    this.listing = true;
    try {
      while (this.dirty && !this.closed) {
        this.dirty = false;
        // A follower that joins mid-listing is newer than this listing's
        // pages; only followers that predate it may be pruned by its result.
        const eligible = new Set(this.followers.keys());
        let cursor: string | undefined;
        const found = new Set<SessionId>();
        do {
          const parent = this.parent.sessionId;
          const page = await this.options.nyte.sessions.list(
            cursor === undefined ? { parent } : { parent, cursor },
          );
          if (this.closed) return;
          for (const info of page.items) {
            found.add(info.sessionId);
            if (this.followers.has(info.sessionId)) continue;
            try {
              await this.start(info.sessionId);
            } catch (error) {
              if (!this.closed)
                this.options.onError(error instanceof Error ? error : new Error(String(error)));
            }
          }
          cursor = page.next;
        } while (cursor !== undefined && !this.closed);
        for (const [id, follower] of this.followers) {
          if (found.has(id) || !eligible.has(id)) continue;
          follower.close();
          this.followers.delete(id);
          this.children.delete(id);
        }
        if (!this.closed) this.options.onChange();
      }
    } catch (error) {
      if (!this.closed)
        this.options.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.listing = false;
    }
  }
}
