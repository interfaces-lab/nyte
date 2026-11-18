import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { ChatDirectory } from "../chats/index.ts";
import { noDrafts } from "../../test/panes.ts";
import { initialWindow, reduce } from "./model.ts";
import type { WindowAction, WindowState } from "./model.ts";
import { windowTabItems } from "./tab-items.ts";

let lastId = 0;

function createId(): string {
  lastId += 1;

  return `t${String(lastId)}`;
}

const NO_CHATS: ChatDirectory = new Map();

function run(state: WindowState, actions: readonly WindowAction[]): WindowState {
  return actions.reduce((current, action) => reduce(current, action, createId, noDrafts), state);
}

const start = run(initialWindow("t0", createId), [
  {
    kind: "open",
    place: { kind: "session", sessionId: asId<"session">("a") },
    target: "permanent",
  },
  { kind: "new-tab" },
]);

test.each([
  ["nothing changed", [], [true, true], true],
  [
    "a chat opened in the background",
    [
      {
        kind: "open",
        place: { kind: "session", sessionId: asId<"session">("c") },
        target: "background",
      },
    ],
    [true, true, false],
    false,
  ],
  ["the first tab closed", [{ kind: "close-tab", tabId: start.tabs[0]?.id ?? "" }], [true], false],
  [
    "the new chat tab shows a chat",
    [{ kind: "open", place: { kind: "session", sessionId: asId<"session">("b") }, target: "here" }],
    [true, false],
    false,
  ],
] satisfies readonly (readonly [string, readonly WindowAction[], readonly boolean[], boolean])[])(
  "%s",
  (_name, actions, kept, same) => {
    const previous = windowTabItems(start, NO_CHATS, [], []);
    const items = windowTabItems(run(start, actions), NO_CHATS, [], previous);

    expect(items.map((item) => previous.includes(item))).toEqual(kept);
    expect(items === previous).toBe(same);
  },
);

test("the first items describe each tab, with the new-chat glyph on a chat and a blank tab alike", () => {
  expect(
    windowTabItems(start, NO_CHATS, [], []).map((item) => [item.title, item.glyph, item.chat]),
  ).toEqual([
    ["Chat", "new-chat", "a"],
    ["New chat", "new-chat", undefined],
  ]);
});
