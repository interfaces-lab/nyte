import type { MessageId } from "@nyte-ai/sdk";
import { NOWHERE } from "./transcript-scroll.ts";
import type { TranscriptPlace } from "./transcript-scroll.ts";

const PILL_LIMIT = 30;

export interface Reply {
  readonly id: MessageId;
  readonly at: number;
  readonly row: string;
}

/** Never stored: the next visit starts again from the read mark the host keeps. */
export interface UnreadVisit {
  /** Replies that started after this time are unread. Null while it follows the latest reply, so replies the reader watches arrive get no divider. */
  readonly boundary: number | null;
  /** The divider whose up pill is done: clicked, seen, or overtaken by new arrivals. */
  readonly acknowledged: MessageId | null;
  /** While the reader is away from the end, the time of the newest reply when they left it: later replies are new. */
  readonly since: number | null;
  readonly place: TranscriptPlace;
}

export type UnreadEvent =
  | { readonly kind: "observed"; readonly active: boolean }
  | { readonly kind: "placed"; readonly place: TranscriptPlace }
  | { readonly kind: "revealed" }
  | { readonly kind: "dismissed"; readonly direction: "up" | "down" };

export interface NewMessagesPill {
  readonly direction: "up" | "down";
  readonly count: number;
}

export interface Unread {
  readonly divider: Reply | undefined;
  /** One pill at a time; new arrivals below win over unread replies above. */
  readonly pill: NewMessagesPill | null;
}

/** Takes the read mark as the host kept it, before this visit advances it. */
export function openVisit(seenThrough: number | null): UnreadVisit {
  return { boundary: seenThrough, acknowledged: null, since: null, place: NOWHERE };
}

export function nextVisit(
  visit: UnreadVisit,
  event: UnreadEvent,
  replies: readonly Reply[],
): UnreadVisit {
  const latest = replies.at(-1)?.at ?? -Infinity;
  const divider = firstUnread(visit.boundary, replies);

  switch (event.kind) {
    case "observed": {
      const boundary =
        visit.boundary === null
          ? event.active
            ? null
            : latest
          : event.active && divider === undefined
            ? null
            : visit.boundary;

      const acknowledged =
        divider !== undefined && countAfter(visit.since, replies) > 0
          ? divider.id
          : visit.acknowledged;

      return boundary === visit.boundary && acknowledged === visit.acknowledged
        ? visit
        : { ...visit, boundary, acknowledged };
    }

    case "placed": {
      const { place } = event;

      const seen =
        place.marker === "inside" || (visit.place.marker === "above" && place.marker === "below");

      return {
        ...visit,
        place,
        since: place.away ? (visit.since ?? latest) : null,
        acknowledged: seen && divider !== undefined ? divider.id : visit.acknowledged,
      };
    }

    case "revealed":
      return { ...visit, acknowledged: divider?.id ?? visit.acknowledged };
    case "dismissed":
      return event.direction === "up"
        ? { ...visit, boundary: latest }
        : { ...visit, since: visit.since === null ? null : latest };
    default: {
      const _exhaustive: never = event;

      return _exhaustive;
    }
  }
}

export function readUnread(visit: UnreadVisit, replies: readonly Reply[]): Unread {
  const divider = firstUnread(visit.boundary, replies);
  const arrived = countAfter(visit.since, replies);

  if (visit.place.away && arrived > 0)
    return { divider, pill: { direction: "down", count: arrived } };

  if (divider === undefined || visit.place.marker !== "above" || visit.acknowledged === divider.id)
    return { divider, pill: null };

  return { divider, pill: { direction: "up", count: countAfter(visit.boundary, replies) } };
}

export function pillLabel(count: number): string {
  if (count > PILL_LIMIT) return `${String(PILL_LIMIT)}+ New Messages`;

  return count === 1 ? "1 New Message" : `${String(count)} New Messages`;
}

function firstUnread(boundary: number | null, replies: readonly Reply[]): Reply | undefined {
  return boundary === null ? undefined : replies.find((reply) => reply.at > boundary);
}

function countAfter(time: number | null, replies: readonly Reply[]): number {
  return time === null ? 0 : replies.filter((reply) => reply.at > time).length;
}
