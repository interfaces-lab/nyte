/** Task rows are views of sessions and shell calls, never another execution registry. */
import type { Nyte, SessionEvent, SessionId, ToolTurnPart, Turn } from "@nyte-ai/core";
import { userText } from "./format.ts";
import { isJsonObject, isJsonString } from "./json.ts";
import { SessionFollower } from "./session-follow.ts";
import type { SessionState } from "./session-state.ts";

type Conversation = Extract<Turn, { kind: "turn" }>;
export type Task =
  | { readonly kind: "agent"; readonly id: string; readonly state: SessionState }
  | {
      readonly kind: "shell";
      readonly id: string;
      readonly state: SessionState;
      readonly turn: Conversation;
      readonly part: ToolTurnPart;
    };

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "retrying"
  | "stopping"
  | "stopped"
  | "done"
  | "failed";

export function taskStatus(task: Task): TaskStatus {
  const run = task.state.run;
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
      return task.kind === "shell" ? "stopped" : "done";
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
  return (
    task.state.run !== undefined &&
    !["done", "aborted", "failed"].includes(task.state.run.phase.kind) &&
    task.state.run.abortRequested !== true
  );
}

export function taskLabel(task: Task): string {
  if (task.kind === "shell") {
    const args = task.part.args;
    return isJsonObject(args) && isJsonString(args.command) ? args.command : "bash";
  }
  const info = task.state.info;
  if (info.name !== undefined) return info.name;
  for (const item of task.state.transcript.items) {
    if (item.kind !== "turn") continue;
    const user = item.parts.find((part) => part.kind === "user");
    if (user !== undefined) return oneLine(userText(user.content));
  }
  return info.preview ?? info.parent?.agent ?? info.sessionId;
}

function oneLine(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

export function taskActivity(task: Task): string {
  const { state } = task;
  const progress = state.overlay.findLast(
    (part) => part.kind === "tool" && (task.kind === "agent" || part.callId === task.part.callId),
  );
  if (progress?.kind === "tool") return oneLine(progress.progress.title ?? progress.progress.text);
  if (task.kind === "shell") return "";
  if (state.run?.phase.kind === "failed" || state.run?.phase.kind === "retry")
    return state.run.phase.error;
  const last = state.transcript.items.findLast((item) => item.kind === "turn");
  const part = last?.parts.findLast((item) => item.kind !== "thinking");
  if (part?.kind === "tool") return `${part.toolName} ${part.result?.title ?? ""}`.trim();
  if (part?.kind === "assistant") return oneLine(part.text);
  return "";
}

export function projectTasks(parent: SessionState, children: readonly SessionState[]): Task[] {
  const tasks: Task[] = [];
  for (const state of [parent, ...children]) {
    if (state !== parent) tasks.push({ kind: "agent", id: state.sessionId, state });
    // Keep only shell calls still running in the latest turn; finished commands are
    // transcript history, not work to track.
    const turn = state.transcript.items.findLast((item) => item.kind === "turn");
    if (turn === undefined) continue;
    for (const part of turn.parts) {
      if (part.kind === "tool" && part.toolName === "bash" && part.result === undefined) {
        tasks.push({ kind: "shell", id: `${state.sessionId}:${part.callId}`, state, turn, part });
      }
    }
  }
  return tasks;
}

interface TaskIndexOptions {
  readonly nyte: Nyte;
  readonly onChange: () => void;
  readonly onError: (error: Error) => void;
}

/** One follower per child. Parent links recover children whose progress event was missed. */
export class TaskIndex {
  private parent: SessionState | undefined;
  private readonly followers = new Map<SessionId, SessionFollower>();
  private readonly children = new Map<SessionId, SessionState>();
  private closed = false;
  private listing = false;
  private dirty = false;

  private readonly options: TaskIndexOptions;

  constructor(options: TaskIndexOptions) {
    this.options = options;
  }

  get tasks(): readonly Task[] {
    if (this.parent === undefined) return [];
    return projectTasks(
      this.parent,
      [...this.children.values()].toSorted(
        (a, b) => a.info.createdAt - b.info.createdAt || a.sessionId.localeCompare(b.sessionId),
      ),
    );
  }

  update(state: SessionState, event?: SessionEvent): void {
    if (this.closed) return;
    this.parent = state;
    this.options.onChange();
    if (
      event === undefined ||
      event.kind === "commit" ||
      event.kind === "effect" ||
      (event.kind === "tool_progress" &&
        isJsonObject(event.progress.details) &&
        isJsonString(event.progress.details.childSessionId))
    ) {
      this.dirty = true;
      void this.discover();
    }
  }

  close(): void {
    this.closed = true;
    for (const follower of this.followers.values()) follower.close();
    this.followers.clear();
    this.children.clear();
  }

  private async discover(): Promise<void> {
    if (this.listing || this.closed || this.parent === undefined) return;
    this.listing = true;
    try {
      while (this.dirty && !this.closed) {
        this.dirty = false;
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
            const follower = new SessionFollower(this.options.nyte, {
              sessionId: info.sessionId,
              onUpdate: ({ state }) => {
                if (this.closed || this.followers.get(info.sessionId) !== follower) return;
                this.children.set(info.sessionId, state);
                this.options.onChange();
              },
              onError: this.options.onError,
            });
            this.followers.set(info.sessionId, follower);
            try {
              await follower.start();
            } catch (error) {
              follower.close();
              this.followers.delete(info.sessionId);
              if (!this.closed)
                this.options.onError(error instanceof Error ? error : new Error(String(error)));
            }
          }
          cursor = page.next;
        } while (cursor !== undefined && !this.closed);
        for (const [id, follower] of this.followers) {
          if (found.has(id)) continue;
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
