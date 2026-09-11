/**
 * The store contract: what a backend implements and what every kernel helper
 * calls. One session is one repository. Four namespaces, four authorities:
 *
 * - `objects`: content-addressed, immutable, written before any ref names them.
 * - `refs`: the only mutable state, moved by multi-ref compare-and-swap.
 * - `leases`: fenced execution rights over a name; never history.
 * - `events`: one ordered stream per session; the reflog and the live feed.
 *
 * `refs.update` is the one place state changes. It checks every `from`, checks
 * the lease when one is given, writes every `to`, appends one `ref` event per
 * update plus any extra events, and publishes to watchers, all in one
 * transaction. A backend that cannot hold that transaction cannot host the
 * kernel.
 */
import type {
  Actor,
  Commit,
  Event,
  EventBody,
  Lease,
  LeaseOutcome,
  Obj,
  Oid,
  RefName,
  RefUpdate,
  RefUpdateOutcome,
  Seq,
} from "./model.ts";

export interface Objects {
  /** Idempotent: an object already present is not rewritten. Returns each object's oid in order. */
  put(objects: readonly Obj[]): Promise<readonly Oid[]>;
  get(oid: Oid): Promise<Obj | undefined>;
  /**
   * The object at `from` and the objects its `parent` field names, newest
   * first, at most `limit`. Stops at a missing object or an object without a
   * parent. Content is verified like `get`; kind and cycle checks are the
   * caller's. One query, like git's commit-graph: a graph walk pays one round
   * trip per page, not one per commit.
   */
  chain(
    from: Oid,
    options: { readonly limit: number },
  ): Promise<readonly { readonly oid: Oid; readonly object: Obj }[]>;
  /** Every stored oid with when it was written, for the collector. */
  list(): Promise<readonly { readonly oid: Oid; readonly at: number }[]>;
  /**
   * Every retained commit once, oldest first, including abandoned branches and
   * loose commits from failed publication. History totals and the tree picker
   * must not lose records merely because a head moved. GC can still remove them.
   * One read of the commit rows alone: blobs and effects outweigh commits and
   * are never needed to answer this.
   */
  commits(): Promise<readonly { readonly oid: Oid; readonly commit: Commit }[]>;
  /** Removes what the collector proved unreachable. Returns how many rows went. */
  delete(oids: readonly Oid[]): Promise<number>;
}

export interface RefUpdateOptions {
  /** The reflog message, e.g. `submit`, `land`, `respond`, `move`. */
  readonly reason: string;
  /** Required for every runner write; a stale fence fails the whole update. */
  readonly lease?: Lease;
  readonly actor?: Actor;
  /** Appended after the `ref` events, in the same transaction. */
  readonly events?: readonly EventBody[];
}

export interface Refs {
  /** `null` when the ref does not exist. */
  read(name: RefName): Promise<Oid | null>;
  /** Every ref whose name starts with `prefix`, sorted by name. */
  list(prefix: string): Promise<readonly { readonly name: RefName; readonly oid: Oid }[]>;
  /**
   * All updates apply or none do. A `to` of `null` deletes the ref. An update
   * whose `to` equals `from` is an assertion: it must hold, and it writes no
   * row and no event.
   */
  update(updates: readonly RefUpdate[], options: RefUpdateOptions): Promise<RefUpdateOutcome>;
}

export interface Leases {
  /** Takes the name if free or expired; a takeover increments the fence. Losing is a value. */
  acquire(name: string, ttlMs: number): Promise<LeaseOutcome>;
  /** Extends only this holder's lease, matched on owner and fence, ignoring expiry. */
  renew(lease: Lease, ttlMs: number): Promise<boolean>;
  /** Releases only this holder's lease. A successor's row never matches. */
  release(lease: Lease): Promise<boolean>;
  /** The live, unexpired lease on a name, if any. */
  read(name: string): Promise<Lease | undefined>;
}

export type AppendOutcome =
  | { readonly ok: true; readonly seq: Seq }
  | { readonly ok: false; readonly reason: "fenced" };

export interface Events {
  /** Appends without moving a ref: deltas, progress, notices. Fenced when a lease is given. */
  append(
    events: readonly EventBody[],
    options?: { readonly lease?: Lease },
  ): Promise<AppendOutcome>;
  /** Events with `seq > afterSeq`, oldest first. Throws `CursorExpired` below the floor. */
  read(options: { readonly afterSeq: Seq; readonly limit?: number }): Promise<readonly Event[]>;
  /** The newest seq, 0 when empty. A watch cursor without reading. */
  last(): Promise<Seq>;
  /** Events at or below this seq are gone; a cursor there must snapshot. 0 means nothing trimmed. */
  floor(): Promise<Seq>;
  /** Drops events with `seq <= beforeSeq` and raises the floor to it, never past `last()`. */
  trim(beforeSeq: Seq): Promise<void>;
  /**
   * Replays from the cursor, then yields every event published after it, in
   * order, with no gaps and no duplicates, until the signal aborts. No client
   * polls: the backend wakes watchers on every commit.
   */
  watch(options: { readonly afterSeq: Seq; readonly signal?: AbortSignal }): AsyncIterable<Event>;
}

export interface Session {
  readonly id: string;
  readonly objects: Objects;
  readonly refs: Refs;
  readonly leases: Leases;
  readonly events: Events;
  close(): Promise<void>;
}

export interface SessionInfo {
  readonly id: string;
  readonly createdAt: number;
}

export interface Store {
  create(options?: { readonly id?: string }): Promise<Session>;
  open(id: string): Promise<Session>;
  list(): Promise<readonly SessionInfo[]>;
  /** Removes the session and everything it owns. Unknown ids are a no-op. */
  delete(id: string): Promise<void>;
  close(): Promise<void>;
}

/** Thrown by the store and passed through the SDK unchanged; `kind` and `what` name it to a wire mapping. */
export class UnknownSession extends Error {
  readonly kind = "not_found" satisfies "not_found";
  readonly what = "session" satisfies "session";
  readonly id: string;

  constructor(id: string) {
    super(`Unknown session: ${id}`);
    this.name = "UnknownSession";
    this.id = id;
  }
}
