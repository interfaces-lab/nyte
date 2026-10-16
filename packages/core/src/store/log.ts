import { asSeq, SessionEventSchema } from "@nyte-ai/schema";
import type { Json, Ref, RefUpdate, Seq, SessionEvent, SessionId } from "@nyte-ai/schema";
import { SdkError } from "../util/error.ts";
import { parseSessionRef } from "./refs.ts";

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

/** Parses a stored object's text. `JSON.parse` builds only JSON values, so its result is `Json` without a second walk; the record decoders check the shape. */
export function decodeObject(text: string): Json {
  return JSON.parse(text);
}
