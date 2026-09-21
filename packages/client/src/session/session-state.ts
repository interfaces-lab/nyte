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
 * applied locally: a commit whose parent is not the tip, a head that moved
 * somewhere the commits that followed did not reach, or a parked call that
 * only the snapshot can order among its siblings.
 */
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { Selection } from "@nyte-ai/protocol";
import { mergeByDelivery } from "../queue-order.ts";
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
  SessionMetadata,
  SessionSnapshot,
} from "@nyte-ai/protocol";
import { EMPTY_LIVE_PARTS, foldLiveParts } from "../views/live-parts.ts";
import type { LiveParts } from "../views/live-parts.ts";
import { appendTranscriptCommit } from "../views/transcript.ts";
import type { TranscriptState } from "../views/transcript.ts";

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
  /** Calls settled in the current run, retained so a late progress frame cannot restore them. */
  readonly settledToolCalls: ReadonlySet<string>;
  /** The parked calls of `run` as the snapshot lists them, in call order: asks and background waits alike. */
  readonly parked: readonly ParkedCall[];
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

const EMPTY_SETTLED_TOOL_CALLS: ReadonlySet<string> = new Set();

function settleToolCall(
  state: SessionState,
  runId: string | undefined,
  callId: string,
): ReadonlySet<string> {
  if (runId === undefined || state.run?.runId !== runId) return state.settledToolCalls;
  if (state.settledToolCalls.has(callId)) return state.settledToolCalls;
  return new Set([...state.settledToolCalls, callId]);
}

export function stateFromSnapshot(snapshot: SessionSnapshot): SessionState {
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
    settledToolCalls: EMPTY_SETTLED_TOOL_CALLS,
    parked: snapshot.parked ?? [],
    context: snapshot.context,
    expectedTip: undefined,
  };
}

export function snapshotOf(state: SessionState): SessionSnapshot {
  return {
    session: state.info,
    head: state.head,
    config: state.config,
    context: state.context,
    seq: state.seq,
    tip: state.transcript.tip,
    transcript: state.transcript.items,
    pending: state.pending,
    ...(state.run === undefined ? {} : { run: state.run }),
    ...(state.compaction === undefined ? {} : { compaction: state.compaction }),
    parked: state.parked,
  };
}

/** The call a composer answers: the newest ask. Background waits never take the composer over. */
export function waitingCall(
  state: Pick<SessionState, "sessionId" | "parked">,
): WaitingCall | undefined {
  const call = state.parked.findLast((candidate) => candidate.selection !== undefined);
  if (call?.selection === undefined) return undefined;
  return {
    sessionId: state.sessionId,
    runId: call.runId,
    callId: call.callId,
    waitId: call.waitId,
    selection: call.selection,
    ...(call.until === undefined ? {} : { until: call.until }),
  };
}

/**
 * Lay a metadata read over a folded state. Activation is the fold's: every
 * watch replays it, so the stream is never behind a read. Selected inputs are
 * taken only when the read still answers the client's current selection.
 */
export function stateWithMetadata(
  state: SessionState,
  metadata: SessionMetadata,
  selected: boolean,
): SessionState {
  return {
    ...state,
    info: {
      ...metadata.session,
      activation: state.info.activation,
      config: selected ? metadata.session.config : state.info.config,
    },
    config: metadata.config,
    context: metadata.context,
  };
}

/** The tip the transcript is waiting to reach, if it is not there. */
export function tipMismatch(state: SessionState): boolean {
  return state.expectedTip !== undefined && state.expectedTip !== state.transcript.tip;
}

/** Arrival time chooses between deliveries; each chain keeps its chosen order. */
function comparePending(left: PendingItem, right: PendingItem): number {
  const byTime = left.at - right.at;
  if (byTime !== 0) return byTime;
  return left.change < right.change ? -1 : left.change > right.change ? 1 : 0;
}

function upsertPending(items: readonly PendingItem[], item: PendingItem): PendingItem[] {
  const rest = items.filter((existing) => existing.change !== item.change);
  return mergeByDelivery([...rest, item], {
    delivery: (entry) => entry.delivery,
    compare: comparePending,
  });
}

function withoutPending(
  items: readonly PendingItem[],
  change: Oid | undefined,
): readonly PendingItem[] {
  if (change === undefined || !items.some((item) => item.change === change)) return items;
  return mergeByDelivery(
    items.filter((item) => item.change !== change),
    { delivery: (entry) => entry.delivery, compare: comparePending },
  );
}

/**
 * Apply one event. Events for other heads only touch what is head-neutral
 * (facts, deletion). The seq advances with every event but is never a reconnect
 * cursor: siblings can share a seq, so recovery takes a fresh snapshot.
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
      const body = event.item.commit.body;
      const settledToolCalls =
        body.kind === "message" && body.message.role === "toolResult"
          ? settleToolCall(state, event.item.commit.run, body.message.toolCallId)
          : state.settledToolCalls;
      // The head and the inbox base move in one CAS but arrive as separate
      // frames; the change leaves the queue with the commit that landed it, so
      // no frame shows the message both pending and in the transcript.
      return {
        kind: "state",
        state: {
          ...base,
          transcript,
          pending: withoutPending(state.pending, event.item.commit.change),
          overlay: foldLiveParts(state.overlay, event),
          settledToolCalls,
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
      const parked = terminal ? [] : state.parked.filter((call) => call.runId === event.run.runId);
      return {
        kind: "state",
        state: {
          ...base,
          run: event.run,
          overlay,
          settledToolCalls:
            terminal || state.run?.runId !== event.run.runId
              ? EMPTY_SETTLED_TOOL_CALLS
              : state.settledToolCalls,
          parked: parked.length === state.parked.length ? state.parked : parked,
        },
      };
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
        state: { ...base, pending: withoutPending(state.pending, event.change) },
      };
    case "queue_cancelled":
      return {
        kind: "state",
        state: { ...base, pending: withoutPending(state.pending, event.change) },
      };
    case "effect": {
      if (state.run?.runId !== event.runId) return { kind: "state", state: base };
      switch (event.state) {
        case "waiting": {
          // The snapshot orders concurrent asks and rejects a waiting event older than itself.
          if (event.selection !== undefined) return { kind: "resnapshot" };
          // A background wait carries its whole record, so it parks without a read.
          const call: ParkedCall = {
            runId: event.runId,
            callId: event.callId,
            waitId: event.waitId,
            tool: event.tool,
            args: event.args,
            ...(event.until === undefined ? {} : { until: event.until }),
          };
          return {
            kind: "state",
            state: {
              ...base,
              parked: [...state.parked.filter((parked) => parked.callId !== call.callId), call],
            },
          };
        }
        case "expired":
        case "signal":
        case "result": {
          const parked = state.parked.find((call) => call.callId === event.callId);
          if (parked === undefined) return { kind: "state", state: base };
          // These carry no wait generation; only the snapshot tells a settled ask from a replay.
          if (parked.selection !== undefined) return { kind: "resnapshot" };
          return {
            kind: "state",
            state: { ...base, parked: state.parked.filter((call) => call !== parked) },
          };
        }
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
      return {
        kind: "state",
        state: { ...base, overlay: foldLiveParts(state.overlay, event) },
      };
    case "tool_progress":
      if (
        state.run?.runId !== event.runId ||
        isTerminalPhase(state.run.phase) ||
        state.settledToolCalls.has(event.callId)
      )
        return { kind: "state", state: base };
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
    case "job": {
      if (
        event.job.head !== state.head ||
        event.job.phase.kind === "running" ||
        event.job.origin.kind === "user"
      )
        return { kind: "state", state: base };
      return {
        kind: "state",
        state: {
          ...base,
          overlay: foldLiveParts(state.overlay, event),
          settledToolCalls: settleToolCall(state, event.job.origin.runId, event.job.origin.callId),
        },
      };
    }
    case "config_queued":
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
