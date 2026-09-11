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
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { Selection } from "@nyte-ai/protocol";
import { mergeQueuedLanes } from "../kernel/queue.ts";
import type {
  ContextStatus,
  HeadName,
  Oid,
  ParkedCall,
  PendingItem,
  RunInfo,
  Seq,
  SessionEvent,
  SessionId,
  SessionInfo,
  SessionSnapshot,
} from "../kernel/sdk/types.ts";
import { EMPTY_LIVE_PARTS, foldLiveParts } from "../kernel/views/live-parts.ts";
import type { LiveParts } from "../kernel/views/live-parts.ts";
import { appendTranscriptCommit } from "../kernel/views/transcript.ts";
import type { TranscriptState } from "../kernel/views/transcript.ts";

/** A parked call only a participant can answer: the one whose wait carries a selection. */
export type WaitingCall = Pick<ParkedCall, "runId" | "callId" | "waitId" | "until"> & {
  readonly sessionId: SessionId;
  readonly selection: Selection;
};

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
  readonly compaction: SessionSnapshot["compaction"];
  /** In arrival order, so a live turn draws its parts as they came. */
  readonly overlay: LiveParts;
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
  // The shell answers one selection at a time; background waits do not take over the composer.
  const parked = snapshot.parked?.findLast((call) => call.selection !== undefined);
  return {
    sessionId: snapshot.session.sessionId,
    head: snapshot.head,
    seq: snapshot.seq,
    info: snapshot.session,
    config: snapshot.config,
    transcript: { items: snapshot.transcript, tip: snapshot.tip },
    pending: snapshot.pending,
    run: snapshot.run,
    compaction: snapshot.compaction,
    overlay: EMPTY_LIVE_PARTS,
    waiting:
      parked?.selection === undefined
        ? undefined
        : {
            sessionId: snapshot.session.sessionId,
            runId: parked.runId,
            callId: parked.callId,
            waitId: parked.waitId,
            selection: parked.selection,
            ...(parked.until === undefined ? {} : { until: parked.until }),
          },
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

/**
 * Apply one event. Events for other heads only touch what is head-neutral
 * (facts, deletion). The seq advances with every event so a follower resuming
 * after a failure starts where this fold stopped.
 */
export function foldEvent(state: SessionState, event: SessionEvent): FoldOutcome {
  const base: SessionState = { ...state, seq: Math.max(state.seq, event.seq) };
  switch (event.kind) {
    case "activation_changed":
      return {
        kind: "state",
        state: { ...state, info: { ...state.info, activation: event.activation } },
      };
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
          overlay: foldLiveParts(state.overlay, event),
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
      const terminal = isTerminalPhase(event.run.phase);
      const overlay = foldLiveParts(state.overlay, event);
      const waiting =
        !terminal && state.waiting?.runId === event.run.runId ? state.waiting : undefined;
      return { kind: "state", state: { ...base, run: event.run, overlay, waiting } };
    }
    case "compaction":
      if (event.head !== state.head) return { kind: "state", state: base };
      return {
        kind: "state",
        state: { ...base, compaction: event.compaction ?? undefined },
      };
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
      if (state.run?.runId !== event.runId) return { kind: "state", state: base };
      switch (event.state) {
        case "waiting":
          if (
            state.waiting?.runId === event.runId &&
            state.waiting.callId === event.callId &&
            state.waiting.waitId !== event.waitId
          ) {
            return { kind: "state", state: base };
          }
          if (event.selection === undefined) return { kind: "state", state: base };
          return {
            kind: "state",
            state: {
              ...base,
              waiting: {
                sessionId: state.sessionId,
                runId: event.runId,
                callId: event.callId,
                waitId: event.waitId,
                selection: event.selection,
                ...(event.until === undefined ? {} : { until: event.until }),
              },
            },
          };
        case "expired":
        case "signal":
        case "result":
          // The snapshot retains concurrent waits that are not the displayed call.
          if (state.waiting?.runId === event.runId && state.waiting.callId === event.callId)
            return { kind: "resnapshot" };
          return { kind: "state", state: base };
        case "intent":
          return { kind: "state", state: base };
        default: {
          const _exhaustive: never = event;
          return _exhaustive;
        }
      }
    }
    case "text_delta":
    case "reasoning_delta":
    case "tool_progress":
      return {
        kind: "state",
        state: { ...base, overlay: foldLiveParts(state.overlay, event) },
      };
    case "fact":
      if (event.key !== "name") return { kind: "state", state: base };
      return {
        kind: "state",
        state: {
          ...base,
          info: typeof event.value === "string" ? { ...state.info, name: event.value } : state.info,
        },
      };
    case "stack":
    case "deleted":
    case "job":
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
