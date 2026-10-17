import { SdkError, SessionEventSchema } from "@nyte-ai/schema";
import type { DurableEvent, Json, Ref, RefUpdate, SessionEvent, SessionId } from "@nyte-ai/schema";
import { parseSessionRef } from "./refs.ts";

export function admits(update: RefUpdate, current: Ref | undefined): boolean {
  if (update.expect === undefined) return true;

  if (update.expect === "absent") return current === undefined;

  return current?.revision === update.expect;
}

/** The fence refs `updates` need, each once: a set lands only while every one of them exists. */
export function fenceNames(updates: readonly RefUpdate[]): readonly string[] {
  return [
    ...new Set(updates.flatMap((update) => (update.fence === undefined ? [] : [update.fence]))),
  ];
}

export function collectSessionEvents(
  updates: readonly RefUpdate[],
): readonly { readonly session: SessionId; readonly event: DurableEvent }[] {
  return updates.flatMap((update) => {
    if (update.events === undefined || update.events.length === 0) return [];
    const session = parseSessionRef(update.name);

    if (session === null)
      throw new SdkError(
        "internal",
        `${update.name} is outside a session and cannot carry an event`,
      );

    return update.events.map((event) => ({ session, event }));
  });
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
