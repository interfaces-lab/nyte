import assert from "node:assert/strict";
import { test } from "vitest";
import { asId } from "@nyte-ai/schema";
import { CLOSED, nextSideChat } from "./side-chat-state.ts";
import type { SideChatEvent, SideChatShown, SideChatWindow } from "./side-chat-state.ts";

const A = asId<"session">("a");

const B = asId<"session">("b");

const BLANK: SideChatShown = { kind: "new", id: "blank", error: null, question: "" };

const STARTING: SideChatShown = { kind: "starting", question: "Why?" };

const CHAT_A: SideChatShown = { kind: "chat", id: A };

function shown(what: SideChatShown, folded = false): SideChatWindow {
  return { kind: "open", shown: what, folded };
}

const ROWS: readonly {
  readonly name: string;
  readonly window: SideChatWindow;
  readonly event: SideChatEvent;
  readonly next: SideChatWindow | "same";
}[] = [
  {
    name: "open shows a new chat unfolded",
    window: shown(CHAT_A, true),
    event: { kind: "open", shown: BLANK },
    next: shown(BLANK),
  },
  {
    name: "open from closed",
    window: CLOSED,
    event: { kind: "open", shown: CHAT_A },
    next: shown(CHAT_A),
  },
  {
    name: "summon unfolds an open window and keeps what it shows",
    window: shown(STARTING, true),
    event: { kind: "summon", newest: B, blank: BLANK },
    next: shown(STARTING),
  },
  {
    name: "summon on a closed window shows the newest side chat",
    window: CLOSED,
    event: { kind: "summon", newest: B, blank: BLANK },
    next: shown({ kind: "chat", id: B }),
  },
  {
    name: "summon on a closed window with no side chats shows a new one",
    window: CLOSED,
    event: { kind: "summon", newest: undefined, blank: BLANK },
    next: shown(BLANK),
  },
  {
    name: "fold an open window",
    window: shown(CHAT_A),
    event: { kind: "fold", folded: true },
    next: shown(CHAT_A, true),
  },
  {
    name: "fold leaves a closed window closed",
    window: CLOSED,
    event: { kind: "fold", folded: false },
    next: "same",
  },
  {
    name: "a start lands while the window still shows it, folded as it is",
    window: shown(STARTING, true),
    event: { kind: "replace", from: STARTING, to: CHAT_A },
    next: shown(CHAT_A, true),
  },
  {
    name: "a start that finishes after the window moved off it leaves the window alone",
    window: shown(CHAT_A),
    event: { kind: "replace", from: STARTING, to: { kind: "chat", id: B } },
    next: "same",
  },
  {
    name: "an equal start that isn't the one shown doesn't land",
    window: shown(STARTING),
    event: { kind: "replace", from: { kind: "starting", question: "Why?" }, to: CHAT_A },
    next: "same",
  },
  {
    name: "a start doesn't reopen a closed window",
    window: CLOSED,
    event: { kind: "replace", from: STARTING, to: CHAT_A },
    next: "same",
  },
  {
    name: "archive closes the window showing that chat",
    window: shown(CHAT_A, true),
    event: { kind: "archive", id: A },
    next: CLOSED,
  },
  {
    name: "archive of another chat leaves the window",
    window: shown(CHAT_A),
    event: { kind: "archive", id: B },
    next: "same",
  },
  {
    name: "archive leaves a window that shows a new chat",
    window: shown(BLANK),
    event: { kind: "archive", id: A },
    next: "same",
  },
  {
    name: "restore reopens a window that is still closed",
    window: CLOSED,
    event: { kind: "restore", window: shown(CHAT_A, true) },
    next: shown(CHAT_A, true),
  },
  {
    name: "restore leaves a window someone opened since",
    window: shown(BLANK),
    event: { kind: "restore", window: shown(CHAT_A) },
    next: "same",
  },
];

test("the side-chat window moves only as each event allows", () => {
  for (const row of ROWS) {
    const next = nextSideChat(row.window, row.event);

    if (row.next === "same") assert.equal(next, row.window, row.name);
    else {
      assert.deepEqual(next, row.next, row.name);
      assert.notEqual(next, row.window, `${row.name}: a new window wakes its listeners`);
    }
  }
});
