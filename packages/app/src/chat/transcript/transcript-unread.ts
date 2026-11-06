import type { MessageId } from "@nyte-ai/sdk";

export interface Reply {
  readonly id: MessageId;
  readonly at: number;
  readonly row: string;
}

export interface UnreadVisit {
  readonly boundary: number | null;
}

export function openVisit(seenThrough: number | null): UnreadVisit {
  return { boundary: seenThrough };
}

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
