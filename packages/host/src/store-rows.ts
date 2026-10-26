import { asId, SdkError } from "@nyte-ai/schema";
import type { BlobId, ByteReader, Ref, Revision, SessionEvent } from "@nyte-ai/schema";
import { loggedEvent } from "@nyte-ai/core/store";
import type { LoggedRow, StoredObject, StoredRecord } from "@nyte-ai/core/store";

export function prefixEnd(prefix: string): string | null {
  const points = Array.from(prefix);
  const last = points.pop()?.codePointAt(0);

  if (last === undefined) return null;

  if (last === 0x10ffff) return prefixEnd(points.join(""));

  return points.join("") + String.fromCodePoint(last === 0xd7ff ? 0xe000 : last + 1);
}

export function mintRevision(): Revision {
  return asId<"revision">(crypto.randomUUID());
}

export function decodeEvent(seq: number, at: number, text: string): SessionEvent {
  return loggedEvent(seq, at, JSON.parse(text));
}

export function parseNumber(value: unknown): number {
  if (typeof value === "number") return value;

  if (typeof value === "bigint" || typeof value === "string") return Number(value);

  throw new SdkError("internal", "A stored number is malformed.");
}

export function parseText(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") return value;

  throw new SdkError("internal", "A stored text column is malformed.");
}

export function parseRef(row: Readonly<Record<string, unknown>>): Ref {
  const name = parseText(row.name);
  const revision = parseText(row.revision);
  const target = parseText(row.target);

  if (name === null || revision === null)
    throw new SdkError("internal", "A stored ref is malformed.");

  return {
    name,
    target: target === null ? null : asId<"object">(target),
    revision: asId<"revision">(revision),
  };
}

export function parseStoredRecord(row: Readonly<Record<string, unknown>>): StoredRecord {
  const name = parseText(row.name);
  const target = parseText(row.target);
  const revision = parseText(row.revision);
  const body = parseText(row.body);

  if (name === null || target === null || revision === null || body === null)
    throw new SdkError("internal", "A stored ref is malformed.");

  return { name, target: asId<"object">(target), revision, body };
}

export function parseStoredObject(row: Readonly<Record<string, unknown>>): StoredObject {
  const id = parseText(row.id);
  const body = parseText(row.body);

  if (id === null || body === null) throw new SdkError("internal", "A stored object is malformed.");

  return { id: asId<"object">(id), body };
}

export function loggedRow(row: Readonly<Record<string, unknown>>): LoggedRow {
  const event = parseText(row.event);

  if (event === null) throw new SdkError("internal", "A logged event is malformed.");

  return { seq: parseNumber(row.seq), event };
}

export function parseBytes(value: unknown): Uint8Array | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Uint8Array)
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

  throw new SdkError("internal", "A stored blob is malformed.");
}

/** A blob of `size` bytes whose bytes `load` reads only once `chunks()` is iterated. */
export function storedReader(
  id: BlobId,
  size: number,
  load: () => Promise<Uint8Array | null>,
): ByteReader {
  return {
    size,
    mime: null,
    async *chunks() {
      const bytes = await load();

      if (bytes === null) throw new SdkError("unknown", `Blob ${id} is no longer stored.`);

      yield bytes;
    },
    close: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  };
}

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
