/**
 * The client's model of one head, folded from `sessions.snapshot` and the
 * events `watch` yields after it (design record, "Events and views").
 *
 * Durable state is the snapshot's and advances by commit: the transcript fold
 * is core's own, so a restore and a live append land on the same items. The
 * overlay holds what only the stream knows: text and reasoning deltas keyed
 * by `(runId, attempt, index)` and tool progress keyed by call id. An
 * assistant commit settles its run's parts, so the overlay for that run goes
 * the moment the commit lands; a retry or a terminal run phase drops it too.
 * Losing the overlay loses animation frames, never conversation.
 *
 * The fold is pure. It answers `resnapshot` when the stream can no longer be
 * applied locally: a commit whose parent is not the tip, or a head that moved
 * somewhere the commits that followed did not reach.
 */
import { appendTranscriptCommit, mergeQueuedLanes } from "@nyte-ai/core";
import type {
  ContextStatus,
  HeadName,
  Oid,
  PendingItem,
  RunId,
  RunInfo,
  Seq,
  SessionEvent,
  SessionId,
  SessionInfo,
  SessionSnapshot,
  ToolProgress,
  TranscriptState,
} from "@nyte-ai/core";
import type { JsonValue } from "@nyte-ai/schema";
import { isJsonString } from "./json.ts";

export type LivePart =
  | {
      readonly kind: "text";
      readonly runId: RunId;
      readonly attempt: number;
      readonly index: number;
      readonly text: string;
    }
  | {
      readonly kind: "thinking";
      readonly runId: RunId;
      readonly attempt: number;
      readonly index: number;
      readonly text: string;
    }
  | {
      readonly kind: "tool";
      readonly runId: RunId;
      readonly callId: string;
      readonly progress: ToolProgress;
    };

/** Stable identity of a streaming part; the transcript keys its live blocks on it. */
export function livePartKey(part: LivePart): string {
  switch (part.kind) {
    case "text":
    case "thinking":
      return `${part.kind}:${part.runId}:${String(part.attempt)}:${String(part.index)}`;
    case "tool":
      return `tool:${part.callId}`;
    default: {
      const _exhaustive: never = part;
      return _exhaustive;
    }
  }
}

/** A tool call parked on a question only a participant can answer. */
export interface WaitingCall {
  readonly runId: RunId;
  readonly callId: string;
  readonly tool: string;
  readonly args: JsonValue;
}

export interface SessionState {
  readonly sessionId: SessionId;
  readonly head: HeadName;
  /** The newest event applied; the snapshot's seq before any arrives. */
  readonly seq: Seq;
  readonly info: SessionInfo;
  readonly config: SessionSnapshot["config"];
  readonly transcript: TranscriptState;
  /** Oldest first, as `messages.pending` orders them. */
  readonly pending: readonly PendingItem[];
  readonly run: RunInfo | undefined;
  /** In arrival order, so a live turn draws its parts as they came. */
  readonly overlay: readonly LivePart[];
  readonly waiting: WaitingCall | undefined;
  readonly context: ContextStatus;
  /**
   * Where a `head_moved` said the head now is, while the commits that would
   * bring the transcript there have not arrived. Cleared once they do; a tip
   * that never catches up means the head went somewhere the fold cannot
   * follow, and the follower takes a snapshot.
   */
  readonly expectedTip: Oid | null | undefined;
}

export type FoldOutcome =
  | { readonly kind: "state"; readonly state: SessionState }
  | { readonly kind: "resnapshot" };

export function stateFromSnapshot(snapshot: SessionSnapshot): SessionState {
  // The shell answers one question at a time; background waits do not take over the composer.
  const parked = snapshot.parked?.findLast((call) => call.tool === "question");
  return {
    sessionId: snapshot.session.sessionId,
    head: snapshot.head,
    seq: snapshot.seq,
    info: snapshot.session,
    config: snapshot.config,
    transcript: { items: snapshot.transcript, tip: snapshot.tip },
    pending: snapshot.pending,
    run: snapshot.run,
    overlay: [],
    waiting:
      parked === undefined
        ? undefined
        : { runId: parked.runId, callId: parked.callId, tool: parked.tool, args: parked.args },
    context: snapshot.context,
    expectedTip: undefined,
  };
}

/** The tip the transcript is waiting to reach, if it is not there. */
export function tipMismatch(state: SessionState): boolean {
  return state.expectedTip !== undefined && state.expectedTip !== state.transcript.tip;
}

/** Arrival time chooses between lanes; each lane preserves its delivery order. */
function comparePending(left: PendingItem, right: PendingItem): number {
  const byTime = left.at - right.at;
  if (byTime !== 0) return byTime;
  return left.change < right.change ? -1 : left.change > right.change ? 1 : 0;
}

function upsertPending(items: readonly PendingItem[], item: PendingItem): PendingItem[] {
  const rest = items.filter((existing) => existing.change !== item.change);
  return mergeQueuedLanes([...rest, item], {
    lane: (entry) => entry.lane,
    compare: comparePending,
  });
}

function appendText(
  overlay: readonly LivePart[],
  part: Extract<LivePart, { kind: "text" | "thinking" }>,
): LivePart[] {
  const key = livePartKey(part);
  let found = false;
  const next = overlay.map((existing) => {
    if (livePartKey(existing) !== key || existing.kind !== part.kind) return existing;
    found = true;
    return { ...existing, text: existing.text + part.text };
  });
  return found ? next : [...next, part];
}

function setProgress(
  overlay: readonly LivePart[],
  part: Extract<LivePart, { kind: "tool" }>,
): LivePart[] {
  const key = livePartKey(part);
  const without = overlay.filter((existing) => livePartKey(existing) !== key);
  return [...without, part];
}

function dropRun(overlay: readonly LivePart[], runId: RunId): LivePart[] {
  return overlay.filter((part) => part.runId !== runId);
}

function dropCall(overlay: readonly LivePart[], callId: string): LivePart[] {
  return overlay.filter((part) => part.kind !== "tool" || part.callId !== callId);
}

/** What the commit settles in the overlay: its run's streamed message, or a tool call's progress. */
function settleOverlay(
  overlay: readonly LivePart[],
  item: Extract<SessionEvent, { kind: "commit" }>["item"],
): readonly LivePart[] {
  const { body } = item.commit;
  if (body.kind !== "message") return overlay;
  switch (body.message.role) {
    case "assistant":
      return item.commit.run === undefined ? overlay : dropRun(overlay, item.commit.run);
    case "toolResult":
      return dropCall(overlay, body.message.toolCallId);
    case "user":
      return overlay;
    default: {
      const _exhaustive: never = body.message;
      return _exhaustive;
    }
  }
}

/**
 * Apply one event. Events for other heads only touch what is head-neutral
 * (facts, deletion). The seq advances with every event so a follower resuming
 * after a failure starts where this fold stopped.
 */
export function foldEvent(state: SessionState, event: SessionEvent): FoldOutcome {
  const base: SessionState = { ...state, seq: Math.max(state.seq, event.seq) };
  switch (event.kind) {
    case "commit": {
      if (event.head !== state.head) return { kind: "state", state: base };
      const transcript = appendTranscriptCommit(state.transcript, event.item);
      if (transcript === undefined) return { kind: "resnapshot" };
      const reached = state.expectedTip === transcript.tip;
      return {
        kind: "state",
        state: {
          ...base,
          transcript,
          overlay: settleOverlay(state.overlay, event.item),
          expectedTip: reached ? undefined : state.expectedTip,
        },
      };
    }
    case "head_moved":
      if (event.head !== state.head) return { kind: "state", state: base };
      return {
        kind: "state",
        state: {
          ...base,
          expectedTip: event.to === state.transcript.tip ? undefined : event.to,
        },
      };
    case "run": {
      if (event.head !== state.head) return { kind: "state", state: base };
      const terminal = ["done", "aborted", "failed"].includes(event.run.phase.kind);
      const retrying = event.run.phase.kind === "retry";
      const overlay =
        terminal || retrying ? dropRun(state.overlay, event.run.runId) : state.overlay;
      const waiting =
        terminal && state.waiting?.runId === event.run.runId ? undefined : state.waiting;
      return { kind: "state", state: { ...base, run: event.run, overlay, waiting } };
    }
    case "queued":
      if (event.head !== state.head) return { kind: "state", state: base };
      return {
        kind: "state",
        state: { ...base, pending: upsertPending(state.pending, event.item) },
      };
    case "landed":
      if (event.head !== state.head) return { kind: "state", state: base };
      return {
        kind: "state",
        state: {
          ...base,
          pending: mergeQueuedLanes(
            state.pending.filter((item) => item.change !== event.change),
            { lane: (entry) => entry.lane, compare: comparePending },
          ),
        },
      };
    case "queue_cancelled":
      return {
        kind: "state",
        state: {
          ...base,
          pending: mergeQueuedLanes(
            state.pending.filter((item) => item.change !== event.change),
            { lane: (entry) => entry.lane, compare: comparePending },
          ),
        },
      };
    case "effect": {
      switch (event.state) {
        case "waiting":
          if (event.tool !== "question") return { kind: "state", state: base };
          return {
            kind: "state",
            state: {
              ...base,
              waiting: {
                runId: event.runId,
                callId: event.callId,
                tool: event.tool,
                args: event.args,
              },
            },
          };
        case "signal":
        case "result":
          return {
            kind: "state",
            state: {
              ...base,
              waiting: state.waiting?.callId === event.callId ? undefined : state.waiting,
            },
          };
        case "intent":
          return { kind: "state", state: base };
        default: {
          const _exhaustive: never = event.state;
          return _exhaustive;
        }
      }
    }
    case "text_delta":
      return {
        kind: "state",
        state: {
          ...base,
          overlay: appendText(state.overlay, {
            kind: "text",
            runId: event.runId,
            attempt: event.attempt,
            index: event.index,
            text: event.delta,
          }),
        },
      };
    case "reasoning_delta":
      return {
        kind: "state",
        state: {
          ...base,
          overlay: appendText(state.overlay, {
            kind: "thinking",
            runId: event.runId,
            attempt: event.attempt,
            index: event.index,
            text: event.delta,
          }),
        },
      };
    case "tool_progress":
      return {
        kind: "state",
        state: {
          ...base,
          overlay: setProgress(state.overlay, {
            kind: "tool",
            runId: event.runId,
            callId: event.callId,
            progress: event.progress,
          }),
        },
      };
    case "fact":
      if (event.key !== "name") return { kind: "state", state: base };
      return {
        kind: "state",
        state: {
          ...base,
          info: isJsonString(event.value) ? { ...state.info, name: event.value } : state.info,
        },
      };
    case "stack":
    case "deleted":
    case "synced":
    case "diagnostic":
    case "plugins_changed":
    case "notification":
    case "status_changed":
      return { kind: "state", state: base };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
