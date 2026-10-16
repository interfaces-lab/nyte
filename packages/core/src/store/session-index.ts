import { asId } from "@nyte-ai/schema";
import type { Json, SessionId } from "@nyte-ai/schema";
import {
  decodeCallRecord,
  decodeInboxRecord,
  decodeReceiptRecord,
  decodeRunRecord,
  decodeSessionRecord,
} from "../contract/records.ts";

/** The current ref names that contribute a directory row or outstanding work. */
export function sessionIndexRef(name: string): {
  readonly session: SessionId;
  readonly kind: "session" | "run" | "inbox" | "receipt" | "call";
} | null {
  const [root, id, group, key, extra] = name.split("/");

  if (root !== "sessions" || id === undefined || id === "") return null;
  const session = asId<"session">(id);

  if (group === undefined) return { session, kind: "session" };
  if (key === undefined || key === "" || extra !== undefined) return null;

  switch (group) {
    case "runs":
      return { session, kind: "run" };
    case "inbox":
      return { session, kind: "inbox" };
    case "receipts":
      return { session, kind: "receipt" };
    case "calls":
      return { session, kind: "call" };
    default:
      return null;
  }
}

/** The derived row for one currently referenced record; null removes its prior index entry. */
export type SessionIndexEntry =
  | {
      readonly kind: "session";
      readonly session: SessionId;
      readonly parent: SessionId | null;
      readonly at: number;
    }
  | {
      readonly kind: "run" | "inbox" | "receipt" | "call";
      readonly session: SessionId;
    };

/** Projects a current ref into the session index. */
export function projectSessionIndex(name: string, object: Json | null): SessionIndexEntry | null {
  const ref = sessionIndexRef(name);

  if (ref === null || object === null) return null;

  switch (ref.kind) {
    case "session": {
      const record = decodeSessionRecord(object);

      return record === null
        ? null
        : {
            kind: "session",
            session: ref.session,
            parent: record.parent,
            at: record.lastActivityAt,
          };
    }
    case "run":
      return decodeRunRecord(object) === null ? null : { kind: "run", session: ref.session };
    case "inbox": {
      const record = decodeInboxRecord(object);

      return record !== null && (record.messages.length > 0 || record.pendingInput.length > 0)
        ? { kind: "inbox", session: ref.session }
        : null;
    }
    case "receipt":
      return decodeReceiptRecord(object)?.outcome === null
        ? { kind: "receipt", session: ref.session }
        : null;
    case "call":
      return decodeCallRecord(object)?.result === null
        ? { kind: "call", session: ref.session }
        : null;
  }
}
