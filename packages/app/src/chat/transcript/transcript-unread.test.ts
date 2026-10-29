import { asId } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import { nextVisit, openVisit, pillLabel, readUnread } from "./transcript-unread.ts";
import type { Reply, UnreadEvent, UnreadVisit } from "./transcript-unread.ts";

function reply(at: number): Reply {
  return { id: asId(`r${String(at)}`), at, row: `response:r${String(at)}` };
}

const read = [reply(10), reply(20)];

const unread = [...read, reply(30), reply(40), reply(50)];

function play(
  visit: UnreadVisit,
  replies: readonly Reply[],
  ...events: readonly UnreadEvent[]
): UnreadVisit {
  return events.reduce((current, event) => nextVisit(current, event, replies), visit);
}

const atEnd = { kind: "placed", place: { away: false, marker: "above" } } as const;

const away = { kind: "placed", place: { away: true, marker: "inside" } } as const;

const above = { kind: "placed", place: { away: true, marker: "above" } } as const;

const focused = { kind: "observed", active: true } as const;

const blurred = { kind: "observed", active: false } as const;

test("opening a chat with three unread replies puts the divider before the first and points up to all three", () => {
  const visit = play(openVisit(20), unread, focused, atEnd);

  expect(readUnread(visit, unread)).toEqual({
    divider: reply(30),
    pill: { direction: "up", count: 3 },
  });
});

test("without a read mark, or with nothing after it, there is no divider", () => {
  expect(readUnread(play(openVisit(null), unread, focused, atEnd), unread)).toEqual({
    divider: undefined,
    pill: null,
  });
  expect(readUnread(play(openVisit(50), unread, focused, atEnd), unread).divider).toBeUndefined();
});

test("clicking or seeing the divider retires the up pill but keeps the divider", () => {
  const opened = play(openVisit(20), unread, focused, atEnd);

  for (const visit of [
    play(opened, unread, { kind: "revealed" }),
    play(opened, unread, { kind: "placed", place: { away: true, marker: "inside" } }),
    play(opened, unread, { kind: "placed", place: { away: true, marker: "below" } }),
    play(opened, unread, { kind: "revealed" }, atEnd),
  ])
    expect(readUnread(visit, unread)).toEqual({ divider: reply(30), pill: null });
});

test("a divider that starts below the view and is jumped past still points up", () => {
  const visit = play(
    openVisit(20),
    unread,
    focused,
    { kind: "placed", place: { away: true, marker: "below" } },
    atEnd,
  );

  expect(readUnread(visit, unread).pill).toEqual({ direction: "up", count: 3 });
});

test("replies arriving below an away reader count once each and win over the up pill for good", () => {
  const left = play(openVisit(20), unread, focused, above);
  const grown = [...unread, reply(60)];
  const streamed = play(left, grown, focused);

  expect(readUnread(streamed, grown)).toEqual({
    divider: reply(30),
    pill: { direction: "down", count: 1 },
  });

  const dismissed = play(streamed, grown, { kind: "dismissed", direction: "down" });

  expect(readUnread(dismissed, grown)).toEqual({ divider: reply(30), pill: null });

  const again = [...grown, reply(70)];

  expect(readUnread(play(dismissed, again, focused), again).pill).toEqual({
    direction: "down",
    count: 1,
  });
});

test("reaching the end clears the arrivals without bringing back the up pill they overtook", () => {
  const grown = [...unread, reply(60)];
  const returned = play(openVisit(20), unread, focused, above);
  const back = play(returned, grown, focused, atEnd);

  expect(readUnread(back, grown)).toEqual({ divider: reply(30), pill: null });
});

test("dismissing the up pill removes the divider without moving anything", () => {
  const opened = play(openVisit(20), unread, focused, atEnd);
  const dismissed = play(opened, unread, { kind: "dismissed", direction: "up" }, focused);

  expect(readUnread(dismissed, unread)).toEqual({ divider: undefined, pill: null });
  expect(dismissed.place).toBe(opened.place);
});

test("replies the reader watches arrive get no divider, and ones that arrive while the window is away do", () => {
  const watching = play(openVisit(20), read, focused, atEnd);
  const arrived = [...read, reply(30)];

  expect(readUnread(play(watching, arrived, focused), arrived).divider).toBeUndefined();

  const left = play(watching, arrived, focused, blurred);
  const later = [...arrived, reply(40), reply(50)];
  const back = play(left, later, focused);

  expect(readUnread(back, later)).toEqual({
    divider: reply(40),
    pill: { direction: "up", count: 2 },
  });
});

test("an away reader's arrivals count from the newest reply when they left", () => {
  const visit = play(openVisit(null), read, focused, away);
  const grown = [...read, reply(30)];

  expect(readUnread(play(visit, grown, focused), grown).pill).toEqual({
    direction: "down",
    count: 1,
  });
  expect(readUnread(play(visit, grown, focused, atEnd), grown).pill).toBeNull();
});

test("the label counts one, many, and stops at 30", () => {
  expect([1, 2, 30, 31].map(pillLabel)).toEqual([
    "1 New Message",
    "2 New Messages",
    "30 New Messages",
    "30+ New Messages",
  ]);
});
