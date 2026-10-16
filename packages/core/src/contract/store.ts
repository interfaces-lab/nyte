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
  get(id: ObjectId): Promise<Json | null>;
  putBlob(bytes: AsyncIterable<Uint8Array>): Promise<BlobId>;
  blob(id: BlobId): Promise<ByteReader | null>;
}

export interface RefStore {
  get(name: string): Promise<Ref | null>;
  list(prefix: string): Promise<readonly Ref[]>;

  set(updates: readonly RefUpdate[]): Promise<SetOutcome>;
  log(session: SessionId, after: Seq, limit: number): Promise<readonly SessionEvent[]>;
  tail(session: SessionId): Promise<Seq>;
}
