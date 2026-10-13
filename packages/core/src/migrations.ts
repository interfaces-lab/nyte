import type { Json } from "@nyte-ai/schema";
import { isJsonObject } from "./records.ts";

/** One rewrite a store applies once, on open, to every object a ref points at: `rewrite` returns the object as it should be stored now, or null when it is already current. A store records the applied names so each runs once. */
export interface StoreMigration {
  readonly name: string;
  rewrite(object: Json): Json | null;
}

type JsonObject = { readonly [key: string]: Json };

/** Returns `object` with `body` replaced by `patch(body)`, or null when the patch leaves it as it was. */
function patched(object: Json, patch: (body: JsonObject) => JsonObject): Json | null {
  if (!isJsonObject(object) || !isJsonObject(object.body)) return null;
  const body = patch(object.body);

  return body === object.body ? null : { ...object, body };
}

/** Returns `body` with each missing `defaults` key filled, or `body` itself when none is missing. */
function filled(body: JsonObject, defaults: JsonObject): JsonObject {
  const missing = Object.entries(defaults).filter(([key]) => !(key in body));

  return missing.length === 0 ? body : { ...body, ...Object.fromEntries(missing) };
}

/** The fields the schema decoders came to require that records written before them lack (`reran`, `pendingInput`, `waitedBy`, `parked`, `lastSnapshot`, `codes`), and the one they dropped (`lastSeenAt`). */
const recordFields: StoreMigration = {
  name: "2026-10-12-record-fields",
  rewrite(object) {
    if (!isJsonObject(object)) return null;

    switch (object.kind) {
      case "call":
        return patched(object, (body) => filled(body, { reran: null }));
      case "inbox":
        return patched(object, (body) => filled(body, { pendingInput: [] }));
      case "run":
        return patched(object, (body) =>
          filled(body, { waitedBy: [], parked: [], lastSnapshot: null }),
        );
      case "principals":
        return patched(object, (body) => {
          const principals = Array.isArray(body.principals) ? body.principals : [];
          const dated = principals.some((entry) => isJsonObject(entry) && "lastSeenAt" in entry);

          if (!dated && "codes" in body) return body;

          return {
            ...filled(body, { codes: [] }),
            principals: principals.map((entry) =>
              isJsonObject(entry)
                ? Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "lastSeenAt"))
                : entry,
            ),
          };
        });
      default:
        return null;
    }
  },
};

/** Every store migration in the order a store applies them. */
export const STORE_MIGRATIONS: readonly StoreMigration[] = [recordFields];
