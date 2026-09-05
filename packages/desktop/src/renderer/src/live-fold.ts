/**
 * The overlay fold for one open session's `watch` events, as pure functions.
 *
 * Durable events refresh one kernel snapshot. Streaming text stays provisional
 * under `(runId, attempt, index)` until the assistant commit for that attempt
 * lands. Tool progress has no attempt on the wire, so it stays under call id
 * and remembers its run for terminal cleanup.
 */
import type { RunId, RunInfo, Seq, SessionEvent, ToolProgress } from "@nyte-ai/core";

export type LiveRunState = "idle" | "working" | "retrying";

export type LivePartRef =
  | {
      readonly kind: "text";
      readonly runId: RunId;
      readonly attempt: number;
      readonly index: number;
    }
  | {
      readonly kind: "thinking";
      readonly runId: RunId;
      readonly attempt: number;
      readonly index: number;
    };

export interface LiveToolProgress {
  readonly runId: RunId;
  readonly progress: ToolProgress;
}

export interface LiveDiagnostic {
  readonly owner: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

export interface LiveSnapshot {
  readonly runState: LiveRunState;
  readonly retry?: { readonly at: number; readonly message: string };
  /** Streaming text by `${runId}:${attempt}:${index}`. */
  readonly text: ReadonlyMap<string, string>;
  readonly thinking: ReadonlyMap<string, string>;
  readonly tools: ReadonlyMap<string, LiveToolProgress>;
  /** Arrival order of in-flight text and reasoning parts. */
  readonly order: readonly LivePartRef[];
  readonly diagnostics: readonly LiveDiagnostic[];
}

/** How many diagnostics the overlay keeps; older ones scroll off. */
const DIAGNOSTIC_LIMIT = 3;

export const IDLE: LiveSnapshot = {
  runState: "idle",
  text: new Map(),
  thinking: new Map(),
  tools: new Map(),
  order: [],
  diagnostics: [],
};

export function livePartKey(runId: RunId, attempt: number, index: number): string {
  return `${runId}:${String(attempt)}:${String(index)}`;
}

function appendDelta(
  buffers: ReadonlyMap<string, string>,
  key: string,
  delta: string,
): Map<string, string> {
  const next = new Map(buffers);
  next.set(key, (next.get(key) ?? "") + delta);
  return next;
}

function withOrder(order: readonly LivePartRef[], ref: LivePartRef): readonly LivePartRef[] {
  const exists = order.some(
    (existing) =>
      existing.kind === ref.kind &&
      existing.runId === ref.runId &&
      existing.attempt === ref.attempt &&
      existing.index === ref.index,
  );
  return exists ? order : [...order, ref];
}

function withoutRetry(snapshot: LiveSnapshot, runState: LiveRunState): LiveSnapshot {
  return {
    runState,
    text: snapshot.text,
    thinking: snapshot.thinking,
    tools: snapshot.tools,
    order: snapshot.order,
    diagnostics: snapshot.diagnostics,
  };
}

/** Drop the streamed parts `keep` rejects; tools go with their run when `runId` is given. */
function dropParts(
  snapshot: LiveSnapshot,
  keep: (ref: LivePartRef) => boolean,
  runId: RunId | undefined,
): LiveSnapshot {
  const text = new Map(snapshot.text);
  const thinking = new Map(snapshot.thinking);
  for (const ref of snapshot.order) {
    if (keep(ref)) continue;
    const key = livePartKey(ref.runId, ref.attempt, ref.index);
    if (ref.kind === "text") text.delete(key);
    else thinking.delete(key);
  }
  let tools = snapshot.tools;
  if (runId !== undefined) {
    const remaining = new Map(snapshot.tools);
    for (const [callId, tool] of remaining) {
      if (tool.runId === runId) remaining.delete(callId);
    }
    tools = remaining;
  }
  return { ...snapshot, text, thinking, tools, order: snapshot.order.filter(keep) };
}

/**
 * A commit carries its run but not its attempt. The attempt that just
 * committed is the newest one streaming for that run: an earlier attempt
 * ended in a retry, and its buffers were dropped then.
 */
function dropLatestAttempt(snapshot: LiveSnapshot, runId: RunId): LiveSnapshot {
  let latest: number | undefined;
  for (const ref of snapshot.order) {
    if (ref.runId === runId && (latest === undefined || ref.attempt > latest)) {
      latest = ref.attempt;
    }
  }
  if (latest === undefined) return snapshot;
  const attempt = latest;
  return dropParts(snapshot, (ref) => ref.runId !== runId || ref.attempt !== attempt, undefined);
}

function dropRun(snapshot: LiveSnapshot, runId: RunId): LiveSnapshot {
  return dropParts(snapshot, (ref) => ref.runId !== runId, runId);
}

function foldRun(snapshot: LiveSnapshot, run: RunInfo): LiveSnapshot {
  switch (run.phase.kind) {
    case "respond":
    case "tools":
      return withoutRetry(snapshot, "working");
    case "retry":
      // The attempt that failed streamed into these buffers; nothing commits it.
      return {
        ...withoutRetry(dropRun(snapshot, run.runId), "retrying"),
        retry: { at: run.phase.at, message: run.phase.error },
      };
    case "waiting":
      return withoutRetry(snapshot, "idle");
    case "done":
    case "aborted":
    case "failed":
      return withoutRetry(dropRun(snapshot, run.runId), "idle");
    default: {
      const _exhaustive: never = run.phase;
      return _exhaustive;
    }
  }
}

export interface FoldResult {
  readonly snapshot: LiveSnapshot;
  /** The seq the settled thread must reach after this event; absent for ephemeral events. */
  readonly refreshAt?: Seq;
}

/** Fold one watch event into the overlay. Pure: the caller applies the result. */
export function foldEvent(snapshot: LiveSnapshot, event: SessionEvent): FoldResult {
  switch (event.kind) {
    case "synced":
    case "plugins_changed":
    case "notification":
    case "status_changed":
      return { snapshot };
    case "commit": {
      const { commit } = event.item;
      const assistant =
        commit.run !== undefined &&
        commit.body.kind === "message" &&
        commit.body.message.role === "assistant";
      return {
        snapshot: assistant ? dropLatestAttempt(snapshot, commit.run) : snapshot,
        refreshAt: event.seq,
      };
    }
    case "run":
      return { snapshot: foldRun(snapshot, event.run), refreshAt: event.seq };
    case "head_moved":
    case "queued":
    case "landed":
    case "queue_cancelled":
    case "stack":
    case "fact":
    case "deleted":
      return { snapshot, refreshAt: event.seq };
    case "effect":
      // A waiting effect parks the run on a question; the run event follows.
      return event.state === "waiting"
        ? { snapshot: withoutRetry(snapshot, "idle") }
        : { snapshot, refreshAt: event.seq };
    case "text_delta": {
      const key = livePartKey(event.runId, event.attempt, event.index);
      const current = withoutRetry(snapshot, "working");
      return {
        snapshot: {
          ...current,
          text: appendDelta(current.text, key, event.delta),
          order: withOrder(current.order, {
            kind: "text",
            runId: event.runId,
            attempt: event.attempt,
            index: event.index,
          }),
        },
      };
    }
    case "reasoning_delta": {
      const key = livePartKey(event.runId, event.attempt, event.index);
      const current = withoutRetry(snapshot, "working");
      return {
        snapshot: {
          ...current,
          thinking: appendDelta(current.thinking, key, event.delta),
          order: withOrder(current.order, {
            kind: "thinking",
            runId: event.runId,
            attempt: event.attempt,
            index: event.index,
          }),
        },
      };
    }
    case "tool_progress": {
      const current = withoutRetry(snapshot, "working");
      const tools = new Map(current.tools);
      tools.set(event.callId, { runId: event.runId, progress: event.progress });
      return { snapshot: { ...current, tools } };
    }
    case "diagnostic":
      return {
        snapshot: {
          ...snapshot,
          diagnostics: [
            ...snapshot.diagnostics.slice(1 - DIAGNOSTIC_LIMIT),
            { owner: event.owner, level: event.level, message: event.message },
          ],
        },
      };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/**
 * The overlay after a watch resumes from a fresh snapshot: everything before
 * its seq is settled in that snapshot, so no buffer survives, and the run
 * state comes from the run the snapshot reports.
 */
export function resumeFrom(snapshot: LiveSnapshot, run: RunInfo | undefined): LiveSnapshot {
  const cleared = { ...IDLE, diagnostics: snapshot.diagnostics };
  return run === undefined ? cleared : foldRun(cleared, run);
}
