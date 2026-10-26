import type {
  BlobId,
  ByteReader,
  Json,
  ObjectId,
  ParentFilter,
  Ref,
  RefUpdate,
  Revision,
  Seq,
  SessionEvent,
  SessionId,
  SetOutcome,
} from "@nyte-ai/schema";

export interface Store {
  open(): Promise<StoreConnection>;
  close(): Promise<void>;
}

export interface StoreConnection {
  readonly objects: ObjectStore;
  readonly refs: RefStore;
  /** Current session roots and outstanding work, updated atomically with refs. */
  readonly sessions: SessionIndex;
  /** A mark that moves whenever a connection other than this one commits: equal marks mean nothing else wrote in between. Absent where nothing else can write, or where the store cannot tell, so every read and poll goes to the store. */
  commitMark?(): Promise<number>;
  /** Each session's latest fold checkpoint. Absent where the store keeps none, so every cold fold reads its session's log from the start. */
  readonly checkpoints?: FoldCheckpoints;
}

/** A session's fold through `seq`, as core encoded it. */
export interface FoldCheckpoint {
  readonly seq: Seq;
  readonly body: string;
}

/** One fold checkpoint per session, a cache over the log: core ignores a checkpoint it cannot decode and folds that session's log from the start. */
export interface FoldCheckpoints {
  /** The session's checkpoint, or null when it has none. */
  read(session: SessionId): Promise<FoldCheckpoint | null>;
  /** Keeps `checkpoint` as the session's, unless the one kept is at a later seq. */
  write(session: SessionId, checkpoint: FoldCheckpoint): Promise<void>;
  /** The session's logged events after `after`: how many, and their size in bytes as logged. */
  gap(session: SessionId, after: Seq): Promise<{ readonly events: number; readonly bytes: number }>;
}

/** Indexed reads of current session roots and unsettled records, never historical objects. */
export interface SessionIndex {
  /** Roots in descending activity order, then ascending id, strictly after the supplied key. */
  list(input: {
    readonly parents: ParentFilter;
    readonly after?: { readonly at: number; readonly id: SessionId };
    readonly limit: number;
  }): Promise<readonly { readonly ref: Ref; readonly version: Revision }[]>;
  /** Roots with live runs, queued input, unfinished calls or receipts, in ascending id order. */
  work(input: { readonly after?: SessionId; readonly limit: number }): Promise<readonly Ref[]>;
  /** Unsettled receipt or call refs; omitted sessions selects every session. */
  pending(input: {
    readonly kind: "receipt" | "call";
    readonly sessions?: readonly SessionId[];
  }): Promise<readonly Ref[]>;
}

export interface ObjectStore {
  put(object: Json): Promise<ObjectId>;
  /** Null for an object never put, or one `RefStore.set` deleted: read a ref's object with `readHeld`. */
  get(id: ObjectId): Promise<Json | null>;
  putBlob(bytes: AsyncIterable<Uint8Array>): Promise<BlobId>;
  blob(id: BlobId): Promise<ByteReader | null>;
}

export interface RefStore {
  get(name: string): Promise<Ref | null>;
  list(prefix: string): Promise<readonly Ref[]>;

  /** One transaction: `fenced` or `stale` change nothing, and `stale` also names an update whose target object is missing, so the caller puts it again. Each object the updates move a ref off is deleted with them, unless a ref still holds it or it is a commit. */
  set(updates: readonly RefUpdate[]): Promise<SetOutcome>;
  log(session: SessionId, after: Seq, limit: number): Promise<readonly SessionEvent[]>;
  tail(session: SessionId): Promise<Seq>;
}
