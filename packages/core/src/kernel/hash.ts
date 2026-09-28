/**
 * An object's body is its JSON with keys sorted by UTF-16 code units, arrays
 * in order, and `undefined` properties dropped, as RFC 8785 specifies. Its oid
 * is the SHA-256 of that body. A stored body is hashed again on read.
 */
import { createHash } from "node:crypto";
import type { Obj, Oid } from "./model.ts";

export function hashObject(object: Obj): Oid {
  return hashBody(objectBody(object));
}

export function hashBody(body: string): Oid {
  return createHash("sha256").update(body).digest("hex");
}

export function objectBody(object: Obj): string {
  return serializeMembers(object);
}

function serialize(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item) ?? "null").join(",")}]`;
  }

  if (typeof value !== "object" || value === null) return JSON.stringify(value);

  return serializeMembers(value);
}

function serializeMembers(value: object): string {
  const entries: readonly (readonly [string, unknown])[] = Object.entries(value);
  const members: string[] = [];

  for (const [key, member] of entries.toSorted(([left], [right]) => (left < right ? -1 : 1))) {
    const text = serialize(member);

    if (text !== undefined) members.push(`${JSON.stringify(key)}:${text}`);
  }

  return `{${members.join(",")}}`;
}
