import type { BlobId, ByteReader, Json, ObjectId, Ref, RefUpdate, Seq, SessionEvent, SessionId, SetOutcome } from "@nyte-ai/schema";

export interface Store {
  readonly kind: string;
  open(): Promise<StoreConnection>;
  close(): Promise<void>;
}

export interface StoreConnection {
  readonly objects: ObjectStore;
  readonly refs: RefStore;
  close(): Promise<void>;
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
