import { expect, test } from "vitest";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { sessionRow } from "../../test/view-fixtures.ts";
import { changePanes, noDrafts, showIn, splitRight } from "../../test/panes.ts";
import { goneChats, watchedChats } from "./gone-chats.ts";
import { initialWindow, reduce } from "./model.ts";
import type { WindowAction, WindowState } from "./model.ts";

const OPEN = asId<"session">("open");

let lastId = 0;

function createId(): string {
  lastId += 1;

  return `t${String(lastId)}`;
}

function hosted(rows: Readonly<Record<string, boolean>>): ReadonlyMap<SessionId, SessionInfo> {
  return new Map(
    Object.entries(rows).map(([id, archived]) => [
      asId<"session">(id),
      sessionRow(id, { archived }),
    ]),
  );
}

const ids = (values: readonly string[]): ReadonlySet<SessionId> =>
  new Set(values.map((value) => asId<"session">(value)));

test.each([
  ["an open chat archived", { a: false }, { a: true }, [], { close: ["a"], forget: ["a"] }],
  ["a chat already archived when first seen", {}, { a: true }, [], { close: [], forget: ["a"] }],
  ["an archived chat seen again", { a: true }, { a: true }, [], { close: [], forget: ["a"] }],
  ["a missing chat", { a: false }, {}, ["a"], { close: ["a"], forget: ["a"] }],
  ["a chat unarchived", { a: true }, { a: false }, [], { close: [], forget: [] }],
  ["a chat first seen active", {}, { a: false }, [], { close: [], forget: [] }],
  [
    "one archived among others",
    { a: false, b: false },
    { a: true, b: false },
    ["c"],
    { close: ["c", "a"], forget: ["c", "a"] },
  ],
] satisfies readonly (readonly [
  string,
  Readonly<Record<string, boolean>>,
  Readonly<Record<string, boolean>>,
  readonly string[],
  { readonly close: readonly string[]; readonly forget: readonly string[] },
])[])("%s", (_name, before, now, missing, gone) => {
  expect(goneChats(hosted(before), { hosted: hosted(now), missing: ids(missing) })).toEqual({
    close: ids(gone.close),
    forget: ids(gone.forget),
  });
});

function run(actions: readonly ((state: WindowState) => WindowAction)[]): WindowState {
  return actions.reduce(
    (state, action) => reduce(state, action(state), createId, noDrafts),
    initialWindow("t0", createId),
  );
}

const open =
  (id: string): ((state: WindowState) => WindowAction) =>
  () => ({
    kind: "open",
    place: { kind: "session", sessionId: asId<"session">(id) },
    target: "permanent",
  });

test.each([
  ["a new window", [], []],
  ["a chat open in a tab", [open("a")], ["a"]],
  ["chats in two tabs", [open("a"), open("b")], ["a", "b"]],
  [
    "a chat in each pane of a split",
    [
      open("a"),
      (state: WindowState) => changePanes(state, splitRight),
      (state: WindowState) => changePanes(state, showIn({ kind: "session", sessionId: OPEN })),
    ],
    ["a", "open"],
  ],
  [
    "a closed tab's chat",
    [
      open("a"),
      open("b"),
      (state: WindowState) => ({ kind: "close-tab", tabId: state.activeTabId }),
    ],
    ["a", "b"],
  ],
  [
    "a page shows no chat",
    [
      () => ({
        kind: "open",
        place: { kind: "customize", section: undefined, sessionId: undefined },
        target: "permanent",
      }),
    ],
    [],
  ],
] satisfies readonly (readonly [
  string,
  readonly ((state: WindowState) => WindowAction)[],
  readonly string[],
])[])("watched: %s", (_name, actions, watched) => {
  expect(watchedChats(run(actions))).toEqual(ids(watched));
});
