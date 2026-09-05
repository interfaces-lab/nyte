/**
 * The SDK's plain-data contracts: ids, session and run read models, the
 * discriminated outcome of every verb, and the session event. These were
 * `@nyte-ai/core`'s `kernel/sdk/types.ts` data half; core re-exports them so
 * its callers see the same types, and a wire client sees them without core.
 *
 * Verb signatures (the `Sessions`, `Messages`, ... interfaces) stay in core:
 * they carry host concerns such as `AbortSignal`. The remote subset is
 * `RemoteNyte` in `remote.ts`.
 */
import type { JsonValue, ModelThinkingLevel, UserMessage } from "@nyte-ai/schema";
import type { Actor, Commit, ModelRef, Oid, RunPhase, Seq, ToolProgress } from "./kernel.ts";
import type { PluginInfo } from "./plugins.ts";
import type { ContextStatus, Turn } from "./views.ts";

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

export type SessionId = string & { readonly __brand: "SessionId" };
export type RunId = string;
export type HeadName = string;
/** A queue lane name. The host's landing policy says which lanes exist and when each lands. */
export type Lane = string;

function isSessionId(value: string): value is SessionId {
  return value !== "";
}

/** Parse the untrusted string a CLI flag, route, or wire request supplied. */
export function sessionId(value: string): SessionId {
  if (!isSessionId(value)) throw new Error("Invalid session id: empty");
  return value;
}

/** The default head for every verb whose `head` is absent. The kernel has no such head; the SDK does. */
export const MAIN: HeadName = "main";

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------

/** When a lane's changes may land: at every response boundary, or only when no run is live. */
export interface LanePolicy {
  readonly lane: string;
  readonly lands: "boundary" | "idle";
}

/**
 * The runner's landing policy. The kernel knows no lane by name: the caller
 * lists the lanes it serves, in priority order, and says how much of a lane
 * lands at once. `"one"` lands through the first message, so the model
 * answers one message at a time; `"all"` lands every pending change.
 */
export interface Landing {
  readonly lanes: readonly LanePolicy[];
  readonly drain: "one" | "all";
}

/**
 * The landing policy used when a host configures none: `steer` lands at every
 * response boundary, `queue` only once the head is idle, one message at a time.
 * `messages.send` without a lane goes to the first lane of the policy in force.
 */
export const DEFAULT_LANDING: Landing = {
  lanes: [
    { lane: "steer", lands: "boundary" },
    { lane: "queue", lands: "idle" },
  ],
  drain: "one",
};

/** The client-safe run configuration. Unknown stored thinking levels are omitted. */
export interface RunConfig {
  readonly model?: ModelRef;
  readonly thinkingLevel?: ModelThinkingLevel;
  readonly agent?: string;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface HeadInfo {
  readonly head: HeadName;
  readonly tip: Oid | null;
  readonly stack?: {
    readonly parent: HeadName;
    readonly base: Oid | null;
    readonly stale: boolean;
  };
  readonly run?: RunInfo;
}

export interface SessionParent {
  readonly sessionId: SessionId;
  readonly runId: RunId;
  readonly callId: string;
  readonly agent: string;
  readonly depth: number;
}

export interface SessionInfo {
  readonly sessionId: SessionId;
  readonly name?: string;
  readonly preview?: string;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly heads: readonly HeadInfo[];
  readonly config: RunConfig;
  readonly parent?: SessionParent;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly next?: string;
}

/** A tool call the run has parked for a reply (design record, "Suspension and wake"). */
export interface ParkedCall {
  readonly runId: RunId;
  readonly callId: string;
  readonly tool: string;
  readonly args: JsonValue;
}

export interface SessionSnapshot {
  readonly seq: Seq;
  readonly session: SessionInfo;
  readonly head: HeadName;
  readonly tip: Oid | null;
  /** Active run inputs, or the head's declared/last observed inputs when idle. Never reader defaults. */
  readonly config: RunConfig;
  readonly transcript: readonly Turn[];
  readonly pending: readonly PendingItem[];
  readonly run?: RunInfo;
  /**
   * Calls of `run` still waiting for a reply, in call order. A client that
   * opens or resyncs mid-wait answers from here; the `effect` events that
   * announced them went by before its watch began.
   */
  readonly parked?: readonly ParkedCall[];
  readonly context: ContextStatus;
}

export type ConfigureOutcome =
  | { readonly kind: "queued"; readonly change: Oid }
  | { readonly kind: "unknown_model" }
  | { readonly kind: "unknown_agent" };

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface SendInput {
  readonly sessionId: SessionId;
  readonly head?: HeadName;
  readonly content: UserMessage["content"];
  /** One of the lanes in the landing policy; absent means its first lane. Any other lane is refused. */
  readonly lane?: Lane;
  /** Caller-supplied idempotency key. The first submission wins. */
  readonly key?: string;
  readonly agent?: string;
}

export type SendReceipt =
  | { readonly kind: "queued"; readonly change: Oid }
  | { readonly kind: "duplicate"; readonly change: Oid };

export type CancelOutcome =
  | { readonly kind: "cancelled" }
  | { readonly kind: "landed" }
  | { readonly kind: "not_found" };

export type RedeliverOutcome =
  | { readonly kind: "redelivered"; readonly change: Oid }
  | { readonly kind: "unchanged" }
  | { readonly kind: "landed" }
  | { readonly kind: "not_found" };

export interface PendingItem {
  readonly change: Oid;
  readonly lane: Lane;
  readonly at: number;
  readonly content: UserMessage["content"];
  readonly author?: Actor;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface RunInfo {
  readonly runId: RunId;
  readonly head: HeadName;
  readonly phase: RunPhase;
  readonly startedAt: number;
  readonly attempts: number;
  /** Inputs recorded by the executing host; older runs may omit resolved defaults. */
  readonly config: RunConfig;
  readonly abortRequested?: true;
  readonly lease?: { readonly owner: string; readonly expiresAt: number };
}

export type AbortOutcome =
  | { readonly kind: "requested"; readonly runId: RunId }
  | { readonly kind: "not_running" };

export type WaitOutcome =
  | { readonly kind: "idle" }
  | { readonly kind: "waiting"; readonly runId: RunId };

export type ReplyOutcome =
  | { readonly kind: "signalled" }
  | { readonly kind: "not_waiting" }
  | { readonly kind: "not_found" };

export type CompactOutcome =
  | { readonly kind: "compacted"; readonly commit: Oid }
  | { readonly kind: "aborted" }
  | { readonly kind: "nothing_to_compact" }
  | { readonly kind: "busy"; readonly run: RunInfo }
  | { readonly kind: "failed"; readonly message: string };

// ---------------------------------------------------------------------------
// Heads
// ---------------------------------------------------------------------------

export type CreateHeadOutcome =
  | { readonly kind: "created"; readonly tip: Oid | null }
  | { readonly kind: "exists" }
  | { readonly kind: "unknown_parent" };

export type MoveOutcome =
  | {
      readonly kind: "moved";
      readonly from: Oid | null;
      readonly restored?: { readonly commit: Oid; readonly content: UserMessage["content"] };
      readonly summary?: Oid;
    }
  | { readonly kind: "busy"; readonly run: RunInfo }
  | { readonly kind: "moved_since"; readonly tip: Oid | null }
  | { readonly kind: "not_found" }
  | { readonly kind: "failed"; readonly message: string };

export type DeleteHeadOutcome =
  | { readonly kind: "deleted" }
  | { readonly kind: "not_found" }
  | { readonly kind: "busy" };

export type MergeOutcome =
  | { readonly kind: "merged"; readonly tip: Oid }
  | { readonly kind: "stale" }
  | { readonly kind: "empty" }
  | { readonly kind: "no_stack" };

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * One projected event. Several events can share a `seq` (a head move and the
 * commits it landed; a notice stamped with the latest seq), so a consumer
 * must not drop an event because its seq equals the last one seen.
 *
 * A `fact` event whose value was deleted carries no `value` key: JSON has no
 * `undefined`, so the wire omits it and the type says optional.
 */
export type SessionEvent = { readonly seq: Seq } & (
  | {
      readonly kind: "commit";
      readonly head: HeadName;
      readonly item: { readonly oid: Oid; readonly commit: Commit };
    }
  | {
      readonly kind: "head_moved";
      readonly head: HeadName;
      readonly from: Oid | null;
      readonly to: Oid | null;
      readonly reason: string;
      readonly actor?: Actor;
    }
  | { readonly kind: "run"; readonly head: HeadName; readonly run: RunInfo }
  | { readonly kind: "queued"; readonly head: HeadName; readonly item: PendingItem }
  | { readonly kind: "landed"; readonly head: HeadName; readonly change: Oid }
  | { readonly kind: "queue_cancelled"; readonly change: Oid }
  | {
      readonly kind: "effect";
      readonly runId: RunId;
      readonly callId: string;
      readonly state: "intent" | "waiting" | "signal" | "result";
      readonly tool: string;
      readonly args: JsonValue;
    }
  | {
      readonly kind: "stack";
      readonly head: HeadName;
      readonly parent: HeadName;
      readonly base: Oid | null;
    }
  | { readonly kind: "fact"; readonly key: string; readonly value?: JsonValue }
  | { readonly kind: "deleted" }
  | { readonly kind: "synced" }
  | {
      readonly kind: "text_delta";
      readonly runId: RunId;
      readonly attempt: number;
      readonly index: number;
      readonly delta: string;
    }
  | {
      readonly kind: "reasoning_delta";
      readonly runId: RunId;
      readonly attempt: number;
      readonly index: number;
      readonly delta: string;
    }
  | {
      readonly kind: "tool_progress";
      readonly runId: RunId;
      readonly callId: string;
      readonly progress: ToolProgress;
    }
  | {
      readonly kind: "diagnostic";
      readonly level: "info" | "warn" | "error";
      readonly owner: string;
      readonly message: string;
    }
  | { readonly kind: "plugins_changed"; readonly plugins: readonly PluginInfo[] }
  /** A plugin asks for the user's attention outside the conversation. */
  | {
      readonly kind: "notification";
      readonly owner: string;
      readonly title?: string;
      readonly message: string;
      readonly sound: boolean;
    }
  /** The plugin status items to show beside the model, whole list each time. */
  | { readonly kind: "status_changed"; readonly items: readonly string[] }
);

/** What `watch` takes: replay after a cursor, or start live at the tip. Either way `synced` arrives once. */
export type WatchInput = { readonly sessionId: SessionId } & (
  | { readonly afterSeq?: Seq }
  | { readonly live: true }
);
