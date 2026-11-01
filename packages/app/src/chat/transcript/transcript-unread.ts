import type { MessageId } from "@nyte-ai/sdk";

export interface Reply {
  readonly id: MessageId;
  readonly at: number;
  readonly row: string;
}

/** Never stored: the next visit starts again from the read mark the host keeps. */
export interface UnreadVisit {
  /** Replies that started after this time are unread. Null while it follows the latest reply, so replies the reader watches arrive get no divider. */
  readonly boundary: number | null;
}

/** Takes the read mark as the host kept it, before this visit advances it. */
export function openVisit(seenThrough: number | null): UnreadVisit {
  return { boundary: seenThrough };
}

/** `active` is whether the reader is looking at the chat now. */
export function observeVisit(
  visit: UnreadVisit,
  active: boolean,
  replies: readonly Reply[],
): UnreadVisit {
  const latest = replies.at(-1)?.at ?? -Infinity;

  const boundary =
    visit.boundary === null
      ? active
        ? null
        : latest
      : active && firstUnread(visit, replies) === undefined
        ? null
        : visit.boundary;

  return boundary === visit.boundary ? visit : { boundary };
}

export function firstUnread(visit: UnreadVisit, replies: readonly Reply[]): Reply | undefined {
  const boundary = visit.boundary;

  return boundary === null ? undefined : replies.find((reply) => reply.at > boundary);
}
