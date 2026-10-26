import { SdkError, SessionEventSchema } from "@nyte-ai/schema";
import type {
  DurableEvent,
  Json,
  ObjectId,
  Ref,
  RefUpdate,
  SessionEvent,
  SessionId,
} from "@nyte-ai/schema";
import { parseSessionRef } from "./refs.ts";

export function admits(update: RefUpdate, current: Ref | undefined): boolean {
  if (update.expect === undefined) return true;

  if (update.expect === "absent") return current === undefined;

  return current?.revision === update.expect;
}

export function fenceNames(updates: readonly RefUpdate[]): readonly string[] {
  return [...new Set(updates.flatMap((update) => update.fences ?? []))];
}

/** The objects `updates` move refs off, given each ref they name as it stood before them. A store deletes each one, in the same transaction, unless a ref still holds it once the updates apply or it is a commit, which history keeps. */
export function replacedTargets(
  updates: readonly RefUpdate[],
  before: ReadonlyMap<string, Ref | undefined>,
): readonly ObjectId[] {
  const targets = new Map([...before].map(([name, ref]) => [name, ref?.target ?? null]));

  return [
    ...new Set(
      updates.flatMap((update) => {
        const left = targets.get(update.name) ?? null;
        targets.set(update.name, update.target);

        return left === null || left === update.target ? [] : [left];
      }),
    ),
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

export function decodeObject(text: string): Json {
  return JSON.parse(text);
}
