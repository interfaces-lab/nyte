import { asId } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import { firstUnread, observeVisit, openVisit } from "./transcript-unread.ts";
import type { Reply, UnreadVisit } from "./transcript-unread.ts";

function reply(at: number): Reply {
  return { id: asId(`r${String(at)}`), at, row: `response:r${String(at)}` };
}

const read = [reply(10), reply(20)];

const unread = [...read, reply(30), reply(40), reply(50)];

function play(
  visit: UnreadVisit,
  replies: readonly Reply[],
  ...active: readonly boolean[]
): UnreadVisit {
  return active.reduce((current, looking) => observeVisit(current, looking, replies), visit);
}

test("opening a chat with unread replies puts the divider before the first", () => {
  expect(firstUnread(play(openVisit(20), unread, true), unread)).toEqual(reply(30));
});

test("without a read mark, or with nothing after it, there is no divider", () => {
  expect(firstUnread(play(openVisit(null), unread, true), unread)).toBeUndefined();
  expect(firstUnread(play(openVisit(50), unread, true), unread)).toBeUndefined();
});

test("replies the reader watches arrive get no divider, and ones that arrive while the window is away do", () => {
  const watching = play(openVisit(20), read, true);
  const arrived = [...read, reply(30)];

  expect(firstUnread(play(watching, arrived, true), arrived)).toBeUndefined();

  const left = play(watching, arrived, true, false);
  const later = [...arrived, reply(40), reply(50)];

  expect(firstUnread(play(left, later, true), later)).toEqual(reply(40));
});
