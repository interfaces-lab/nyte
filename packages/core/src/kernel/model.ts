/**
 * The kernel's vocabulary: objects, refs, leases, events.
 *
 * Git's object database with messages in place of files. Objects are
 * content-addressed and never change. Refs are the only mutable state and
 * move by compare-and-swap. Leases fence runners and describe no history.
 * Events are the reflog and the stream. Everything else in the kernel is a
 * helper over these four.
 *
 * Messages keep the pi-derived neutral `Message` type from `@nyte-ai/schema`.
 * The kernel stores that type as is: no translation, no second wire.
 */
import type { JsonValue, ToolResultMessage } from "@nyte-ai/schema";
import type {
  Actor,
  Commit,
  CommitBody,
  ModelRef,
  Oid,
  RunPhase,
  Selection,
  Seq,
  ToolProgress,
} from "@nyte-ai/protocol";

/**
 * The shapes that also travel on the wire (a commit, a run phase, tool
 * progress) are declared in `@nyte-ai/protocol` and re-exported here under
 * their kernel names, so a remote client and the kernel read one definition.
 */
export type {
  Actor,
  Choice,
  Commit,
  CommitBody,
  ModelRef,
  Oid,
  RunPhase,
  Selection,
  Seq,
  ToolProgress,
} from "@nyte-ai/protocol";

/** A full ref name such as `refs/heads/main`. */
export type RefName = string;

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

/** A submission waiting to land: a commit body without a parent yet. */
export interface Change {
  readonly kind: "change";
  /** The change submitted before this one on the same queue; null starts the queue. */
  readonly previous: Oid | null;
  /** The change this one replaced when it moved lanes. Keeps the copy's id distinct from the original's. */
  readonly supersedes?: Oid;
  readonly body: CommitBody;
  readonly at: number;
  readonly author?: Actor;
}

export interface RunConfig {
  readonly model?: ModelRef;
  readonly thinkingLevel?: string;
  readonly agent?: string;
}

/** One head being advanced. The run ref holds the current phase; every phase is a new object. */
export interface Run {
  readonly kind: "run";
  readonly id: string;
  /** Branch name, not ref name. */
  readonly head: string;
  readonly phase: RunPhase;
  readonly startedAt: number;
  /** Assistant responses attempted so far: the step ceiling and the delta key. */
  readonly attempts: number;
  /** Branch inputs with the runner's resolved model and thinking defaults captured at start. */
  readonly config: RunConfig;
  /** Set by a participant; the runner honors it at its next publish. */
  readonly abortRequested?: true;
}

/** A tool call's durable states, one ref per call: intent, waiting, expired, signal, result. */
export type Effect =
  | {
      readonly kind: "effect";
      readonly state: "intent";
      readonly runId: string;
      readonly callId: string;
      readonly tool: string;
      readonly args: JsonValue;
      /** After a crash between intent and result: run again, or settle as interrupted. */
      readonly replay: "safe" | "never";
      readonly at: number;
    }
  | {
      readonly kind: "effect";
      readonly state: "waiting";
      readonly intent: Oid;
      readonly at: number;
      /** What a participant is asked to pick. Absent, the call waits on something else, such as a child session. */
      readonly selection?: Selection;
      /** Epoch ms after which a runner wakes the call unanswered. Absent, it waits indefinitely. */
      readonly until?: number;
    }
  | {
      readonly kind: "effect";
      readonly state: "expired";
      readonly intent: Oid;
      readonly at: number;
    }
  | {
      readonly kind: "effect";
      readonly state: "signal";
      readonly intent: Oid;
      readonly signal: JsonValue;
      readonly at: number;
      readonly author?: Actor;
    }
  | {
      readonly kind: "effect";
      readonly state: "result";
      readonly intent: Oid;
      readonly result: ToolResultMessage;
      readonly at: number;
    };

/** Where a head sits in a stack: which head it was cut from and at which commit. */
export interface Stack {
  readonly kind: "stack";
  readonly parent: string;
  readonly base: Oid | null;
}

/** A small value behind a ref: a fact, a marker. */
export interface Blob {
  readonly kind: "blob";
  readonly value: JsonValue;
}

export type Obj = Commit | Change | Run | Effect | Stack | Blob;

// ---------------------------------------------------------------------------
// Refs and leases
// ---------------------------------------------------------------------------

/**
 * One compare-and-swap: the ref must be at `from` for `to` to be written.
 * `null` is absent. `to` equal to `from` asserts without writing.
 */
export interface RefUpdate {
  readonly name: RefName;
  readonly from: Oid | null;
  readonly to: Oid | null;
}

export type RefUpdateOutcome =
  | { readonly ok: true; readonly seq: Seq }
  | {
      readonly ok: false;
      readonly reason: "conflict";
      readonly name: RefName;
      readonly actual: Oid | null;
    }
  | { readonly ok: false; readonly reason: "fenced" };

/** Execution rights over one name, fenced so a successor's writes outrank a predecessor's. */
export interface Lease {
  readonly name: string;
  readonly owner: string;
  readonly fence: number;
  readonly expiresAt: number;
}

export type LeaseOutcome =
  | { readonly ok: true; readonly lease: Lease }
  | { readonly ok: false; readonly holder: Lease };

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventBody =
  /** A ref moved. The reflog: `from` and `to` are the previous and new targets. */
  | {
      readonly kind: "ref";
      readonly name: RefName;
      readonly from: Oid | null;
      readonly to: Oid | null;
      readonly reason: string;
      readonly actor?: Actor;
    }
  /** One streamed piece of the assistant response `attempt` of `runId`. */
  | {
      readonly kind: "delta";
      readonly runId: string;
      readonly attempt: number;
      readonly index: number;
      readonly part: "text" | "thinking";
      readonly delta: string;
    }
  | {
      readonly kind: "progress";
      readonly runId: string;
      readonly callId: string;
      readonly progress: ToolProgress;
    }
  | {
      readonly kind: "notice";
      readonly level: "info" | "warn" | "error";
      readonly owner: string;
      readonly message: string;
    };

export type Event = EventBody & { readonly seq: Seq; readonly at: number };

/** The cursor is older than the stream's floor: take a snapshot, then watch from its seq. */
export class CursorExpired extends Error {
  readonly floor: Seq;
  constructor(floor: Seq) {
    super(`Event cursor is older than the stream floor ${String(floor)}`);
    this.name = "CursorExpired";
    this.floor = floor;
  }
}
