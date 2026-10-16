import { SessionEventSchema, asSeq, isJson } from "@nyte-ai/schema";
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
import { SdkError } from "./error.ts";
import { parseSessionRef } from "./refs.ts";

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

export function admits(update: RefUpdate, current: Ref | undefined): boolean {
  if (update.expect === undefined) return true;

  if (update.expect === "absent") return current === undefined;

  return current?.revision === update.expect;
}

export function collectSessionEvents(
  updates: readonly RefUpdate[],
): readonly { readonly session: SessionId; readonly event: NonNullable<RefUpdate["event"]> }[] {
  return updates.flatMap((update) => {
    if (update.event === undefined) return [];
    const session = parseSessionRef(update.name);

    if (session === null)
      throw new SdkError(
        "internal",
        `${update.name} is outside a session and cannot carry an event`,
      );

    return [{ session, event: update.event }];
  });
}

export function setSeq<T>(
  updates: readonly RefUpdate[],
  appended: readonly Seq[],
  tail: (session: SessionId) => T,
): Seq | T {
  const last = appended.at(-1);

  if (last !== undefined) return last;
  const session = updates.map((update) => parseSessionRef(update.name)).find((id) => id !== null);

  return session ? tail(session) : asSeq(0);
}

export function loggedEvent(seq: number, at: number, body: unknown): SessionEvent {
  const result = SessionEventSchema["~standard"].validate(
    typeof body === "object" && body !== null ? { ...body, seq, at } : body,
  );

  if (result instanceof Promise || result.issues !== undefined)
    throw new SdkError("internal", `The event at seq ${seq} is malformed.`);

  return result.value;
}

export function decodeObject(text: string): Json {
  const value: unknown = JSON.parse(text);

  if (!isJson(value)) throw new SdkError("internal", "A stored object is not JSON.");

  return value;
}
