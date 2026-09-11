/** An object's id is the SHA-256 of its canonical JSON. */
import { createHash } from "node:crypto";
import { canonicalJson } from "./json.ts";
import type { Obj, Oid } from "./model.ts";

export function hashObject(object: Obj): Oid {
  return hashCanonicalJson(canonicalJson(object));
}

/** Hash the same canonical bytes the object writer persists. */
export function hashCanonicalJson(json: string): Oid {
  return createHash("sha256").update(json).digest("hex");
}
