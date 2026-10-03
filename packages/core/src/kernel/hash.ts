/**
 * An object's body is its JSON with keys sorted by UTF-16 code units, arrays
 * in order, and `undefined` properties dropped, as RFC 8785 specifies. Its oid
 * is the SHA-256 of that body. A stored body is hashed again on read.
 */
import { createHash } from "node:crypto";
import { isJsonObject, type JsonObject, type JsonValue } from "@nyte-ai/client";
import type { Obj, Oid } from "./model.ts";

export function hashObject(object: Obj): Oid {
  return hashBody(objectBody(object));
}

export function hashBody(body: string): Oid {
  return createHash("sha256").update(body).digest("hex");
}

export function objectBody(object: Obj): string {
  const json: JsonValue = JSON.parse(JSON.stringify(object));

  return serialize(json);
}

function serialize(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;

  if (!isJsonObject(value)) return JSON.stringify(value);

  return serializeMembers(value);
}

function serializeMembers(value: JsonObject): string {
  const members = Object.entries(value)
    .toSorted(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, member]) => `${JSON.stringify(key)}:${serialize(member)}`);

  return `{${members.join(",")}}`;
}
