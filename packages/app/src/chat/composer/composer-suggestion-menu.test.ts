import { expect, test } from "vitest";
import { CLOSED_MENU, menuKey, nextMenu, pickFor } from "./composer-suggestion-menu.ts";
import type {
  ComposerSuggestion,
  MenuEvent,
  MenuKey,
  MenuState,
  SuggestionToken,
} from "./composer-suggestion-menu.ts";

const slash = (query: string, start = 0): SuggestionToken => ({
  kind: "slash",
  start,
  end: start + query.length + 1,
  query,
});

const SLASH = slash("");

const OPEN: MenuState = { token: SLASH, index: 3, highlighted: true };

test.each<{
  readonly name: string;
  readonly menu: MenuState;
  readonly event: MenuEvent;
  readonly next: MenuState | "same";
}>([
  {
    name: "a token that continues the open one keeps its row",
    menu: OPEN,
    event: { kind: "token", token: slash("de") },
    next: { token: slash("de"), index: 3, highlighted: true },
  },
  {
    name: "a token at another start starts over unhighlighted",
    menu: OPEN,
    event: { kind: "token", token: slash("", 4) },
    next: { token: slash("", 4), index: 0, highlighted: false },
  },
  {
    name: "a token of another kind starts over",
    menu: OPEN,
    event: { kind: "token", token: { kind: "mention", start: 0, end: 1, query: "" } },
    next: { token: { kind: "mention", start: 0, end: 1, query: "" }, index: 0, highlighted: false },
  },
  {
    name: "closing forgets the row",
    menu: OPEN,
    event: { kind: "token", token: undefined },
    next: CLOSED_MENU,
  },
  {
    name: "closing a closed menu changes nothing",
    menu: CLOSED_MENU,
    event: { kind: "token", token: undefined },
    next: "same",
  },
  {
    name: "a move past the last row stops on it",
    menu: { token: SLASH, index: 0, highlighted: false },
    event: { kind: "move", to: 20, count: 5 },
    next: { token: SLASH, index: 4, highlighted: true },
  },
  {
    name: "a move before the first row stops on it",
    menu: OPEN,
    event: { kind: "move", to: -6, count: 17 },
    next: { token: SLASH, index: 0, highlighted: true },
  },
  {
    name: "a move with no rows changes nothing",
    menu: { token: SLASH, index: 0, highlighted: false },
    event: { kind: "move", to: 1, count: 0 },
    next: "same",
  },
  {
    name: "a move onto the active row changes nothing",
    menu: OPEN,
    event: { kind: "move", to: 3, count: 17 },
    next: "same",
  },
  {
    name: "the pointer on another row moves there",
    menu: { token: SLASH, index: 3, highlighted: false },
    event: { kind: "point", index: 1, count: 17 },
    next: { token: SLASH, index: 1, highlighted: true },
  },
  {
    name: "the pointer on the active row only highlights it, keeping a row past the end",
    menu: { token: SLASH, index: 7, highlighted: false },
    event: { kind: "point", index: 2, count: 3 },
    next: { token: SLASH, index: 7, highlighted: true },
  },
  {
    name: "the pointer on the highlighted row changes nothing",
    menu: OPEN,
    event: { kind: "point", index: 3, count: 17 },
    next: "same",
  },
])("the menu: $name", (row) => {
  const next = nextMenu(row.menu, row.event);

  if (row.next === "same") expect(next).toBe(row.menu);
  else expect(next).toEqual(row.next);
});

const KEY = { key: "Enter", ctrlKey: false, shiftKey: false, metaKey: false, isComposing: false };

test.each<{
  readonly key: Partial<typeof KEY> & { readonly altKey?: boolean };
  readonly action: MenuKey;
}>([
  { key: { key: "Escape" }, action: { kind: "close" } },
  { key: { key: "ArrowDown" }, action: { kind: "move", to: 4 } },
  { key: { key: "n", ctrlKey: true }, action: { kind: "move", to: 4 } },
  { key: { key: "j", ctrlKey: true }, action: { kind: "move", to: 4 } },
  { key: { key: "ArrowUp" }, action: { kind: "move", to: 2 } },
  { key: { key: "p", ctrlKey: true }, action: { kind: "move", to: 2 } },
  { key: { key: "k", ctrlKey: true }, action: { kind: "move", to: 2 } },
  { key: { key: "ArrowUp", ctrlKey: true, altKey: true }, action: { kind: "move", to: 2 } },
  { key: { key: "Home" }, action: { kind: "move", to: 0 } },
  { key: { key: "End" }, action: { kind: "move", to: 16 } },
  { key: { key: "PageDown" }, action: { kind: "move", to: 12 } },
  { key: { key: "PageUp" }, action: { kind: "move", to: -6 } },
  { key: {}, action: { kind: "pick" } },
  { key: { key: "Tab" }, action: { kind: "pick" } },
  { key: { key: "Tab", shiftKey: true }, action: { kind: "pass" } },
  { key: { shiftKey: true }, action: { kind: "pass" } },
  { key: { metaKey: true }, action: { kind: "pass" } },
  { key: { ctrlKey: true }, action: { kind: "pass" } },
  { key: { isComposing: true }, action: { kind: "pass" } },
  { key: { key: "n" }, action: { kind: "pass" } },
])("an open menu reads $key as $action.kind", (row) => {
  expect(menuKey({ ...KEY, ...row.key }, 3, 17)).toEqual(row.action);
});

const suggestion = (id: string): ComposerSuggestion => ({
  kind: "argument",
  id,
  label: id,
  description: "",
  icon: "command",
  value: id,
});

const SHOWN = [suggestion("delta"), suggestion("echo")];

test.each<{
  readonly name: string;
  readonly query: string;
  readonly live: readonly ComposerSuggestion[];
  readonly index: number;
  readonly pick: ComposerSuggestion | undefined;
}>([
  { name: "the active shown row", query: "e", live: [], index: 1, pick: suggestion("echo") },
  {
    name: "the first live match while the shown rows lag",
    query: "ec",
    live: [suggestion("echo")],
    index: 0,
    pick: suggestion("echo"),
  },
  {
    name: "nothing when the typed query matches nothing",
    query: "zz",
    live: [],
    index: 0,
    pick: undefined,
  },
  { name: "nothing past the shown rows", query: "e", live: [], index: 2, pick: undefined },
])("Enter picks $name", (row) => {
  expect(pickFor(slash(row.query), "e", SHOWN, () => row.live, row.index)).toEqual(row.pick);
});
