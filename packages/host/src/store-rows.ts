import { SessionEventSchema, asId, asSeq, isJson } from "@nyte-ai/schema";
import type {
  ByteReader,
  Json,
  Ref,
  RefUpdate,
  Revision,
  Seq,
  SessionEvent,
  SessionId,
} from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";

/** Returns the session a ref name lives under (`sessions/<id>/…`), or null. */
export function sessionOf(name: string): SessionId | null {
  const [root, id] = name.split("/");

  return root === "sessions" && id ? asId<"session">(id) : null;
}

/** Returns the first name past every name that starts with `prefix`, so `name >= prefix AND name < end` selects the prefix as a range; null for the empty prefix, whose range is everything. */
export function prefixEnd(prefix: string): string | null {
  if (prefix === "") return null;

  return prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
}

/** Returns whether an update's `expect` holds against the ref as it stood before the batch. */
export function admits(update: RefUpdate, current: Ref | undefined): boolean {
  if (update.expect === undefined) return true;

  if (update.expect === "absent") return current === undefined;

  return current?.revision === update.expect;
}

/** Returns a fresh revision, never reused. */
export function mintRevision(): Revision {
  return asId<"revision">(crypto.randomUUID());
}

/** Returns the events a batch appends with the session each goes to, in entry order; throws `SdkError("internal")` for an event on a ref outside `sessions/`, before anything is written. */
export function eventsOf(
  updates: readonly RefUpdate[],
): readonly { readonly session: SessionId; readonly event: NonNullable<RefUpdate["event"]> }[] {
  return updates.flatMap((update) => {
    if (update.event === undefined) return [];
    const session = sessionOf(update.name);

    if (session === null)
      throw new SdkError(
        "internal",
        `${update.name} is outside a session and cannot carry an event`,
      );

    return [{ session, event: update.event }];
  });
}

/** Returns the `seq` a set answers: the last one appended, else the tail of the first session the batch names, else 0. */
export async function setSeq(
  updates: readonly RefUpdate[],
  appended: readonly Seq[],
  tail: (session: SessionId) => Promise<Seq>,
): Promise<Seq> {
  const last = appended.at(-1);

  if (last !== undefined) return last;
  const session = updates.map((update) => sessionOf(update.name)).find((id) => id !== null);

  return session ? tail(session) : asSeq(0);
}

/** Parses a stored object's JSON text; throws `SdkError("internal")` when it is not JSON. */
export function decodeObject(text: string): Json {
  const value: unknown = JSON.parse(text);

  if (!isJson(value)) throw new SdkError("internal", "A stored object is not JSON.");

  return value;
}

/** Returns a logged event from its stored row, validated as a `SessionEvent`; throws `SdkError("internal")` when the row does not hold one. */
export function decodeEvent(seq: number, at: number, text: string): SessionEvent {
  const event: unknown = JSON.parse(text);

  const result = SessionEventSchema["~standard"].validate(
    typeof event === "object" && event !== null ? { ...event, seq, at } : event,
  );

  if (result instanceof Promise || result.issues !== undefined)
    throw new SdkError("internal", `The event at seq ${seq} is malformed.`);

  return result.value;
}

/** Returns a number a driver answered as a number, a bigint or a numeric string. */
export function numberOf(value: unknown): number {
  if (typeof value === "number") return value;

  if (typeof value === "bigint" || typeof value === "string") return Number(value);

  throw new SdkError("internal", "A stored number is malformed.");
}

/** Returns a string column, or null for a null one. */
export function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") return value;

  throw new SdkError("internal", "A stored text column is malformed.");
}

/** Returns a ref from a stored row's columns. */
export function refOf(row: Readonly<Record<string, unknown>>): Ref {
  const name = textOf(row.name);
  const revision = textOf(row.revision);
  const target = textOf(row.target);

  if (name === null || revision === null)
    throw new SdkError("internal", "A stored ref is malformed.");

  return {
    name,
    target: target === null ? null : asId<"object">(target),
    revision: asId<"revision">(revision),
  };
}

/** Joins a stream's chunks into one buffer. */
export async function collect(bytes: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of bytes) chunks.push(chunk);
  const joined = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return joined;
}

/** Returns a reader over bytes held in memory: their size, a null mime, one chunk. */
export function memoryReader(bytes: Uint8Array): ByteReader {
  return {
    size: bytes.byteLength,
    mime: null,
    async *chunks() {
      yield bytes;
    },
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };
}
