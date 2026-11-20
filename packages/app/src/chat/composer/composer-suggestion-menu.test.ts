import { expect, test } from "vitest";
import { CLOSED_MENU, menuKey, nextMenu, pickFor } from "./composer-suggestion-menu.ts";
import type {
  ComposerSuggestion,
  MenuEvent,
  MenuKey,
  MenuPick,
  MenuPosition,
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

const OPEN: MenuState = { ...CLOSED_MENU, token: SLASH, active: "delta", highlighted: true };

const DISMISSED: MenuState = { ...CLOSED_MENU, dismissed: { kind: "slash", start: 0 } };

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
    next: { ...OPEN, token: slash("de") },
  },
  {
    name: "a token at another start starts over unhighlighted",
    menu: OPEN,
    event: { kind: "token", token: slash("", 4) },
    next: { ...CLOSED_MENU, token: slash("", 4) },
  },
  {
    name: "a token of another kind starts over",
    menu: OPEN,
    event: { kind: "token", token: { kind: "mention", start: 0, end: 1, query: "" } },
    next: { ...CLOSED_MENU, token: { kind: "mention", start: 0, end: 1, query: "" } },
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
    name: "Escape closes and remembers the trigger",
    menu: OPEN,
    event: { kind: "dismiss" },
    next: DISMISSED,
  },
  {
    name: "typing into a dismissed trigger keeps it closed",
    menu: DISMISSED,
    event: { kind: "token", token: slash("de") },
    next: "same",
  },
  {
    name: "a new trigger after a dismissed one opens",
    menu: DISMISSED,
    event: { kind: "token", token: slash("", 4) },
    next: { ...CLOSED_MENU, token: slash("", 4) },
  },
  {
    name: "leaving a dismissed trigger forgets it",
    menu: DISMISSED,
    event: { kind: "token", token: undefined },
    next: CLOSED_MENU,
  },
  {
    name: "selecting a row highlights it",
    menu: { ...CLOSED_MENU, token: SLASH },
    event: { kind: "select", id: "echo" },
    next: { ...CLOSED_MENU, token: SLASH, active: "echo", highlighted: true },
  },
  {
    name: "selecting the highlighted row changes nothing",
    menu: OPEN,
    event: { kind: "select", id: "delta" },
    next: "same",
  },
  {
    name: "rows that keep the active one change nothing",
    menu: OPEN,
    event: { kind: "rows", ids: ["echo", "delta"] },
    next: "same",
  },
  {
    name: "rows without the active one fall back to the first",
    menu: OPEN,
    event: { kind: "rows", ids: ["echo"] },
    next: { ...OPEN, active: undefined },
  },
])("the menu: $name", (row) => {
  const next = nextMenu(row.menu, row.event);

  if (row.next === "same") expect(next).toBe(row.menu);
  else expect(next).toEqual(row.next);
});

const KEY = {
  key: "Enter",
  keyCode: 13,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  repeat: false,
};

const ROOT: MenuPosition = {
  index: 3,
  count: 17,
};

test.each<{
  readonly key: Partial<typeof KEY>;
  readonly position?: Partial<MenuPosition>;
  readonly action: MenuKey;
}>([
  { key: { key: "Escape" }, action: { kind: "close" } },
  { key: { key: "ArrowDown" }, action: { kind: "move", to: 4 } },
  { key: { key: "ArrowDown" }, position: { index: 16 }, action: { kind: "move", to: 0 } },
  { key: { key: "n", ctrlKey: true }, action: { kind: "move", to: 4 } },
  { key: { key: "j", ctrlKey: true }, action: { kind: "move", to: 4 } },
  { key: { key: "ArrowUp" }, action: { kind: "move", to: 2 } },
  { key: { key: "ArrowUp" }, position: { index: 0 }, action: { kind: "move", to: 16 } },
  { key: { key: "p", ctrlKey: true }, action: { kind: "move", to: 2 } },
  { key: { key: "k", ctrlKey: true }, action: { kind: "move", to: 2 } },
  { key: { key: "ArrowUp", ctrlKey: true, altKey: true }, action: { kind: "move", to: 2 } },
  { key: { key: "Home" }, action: { kind: "move", to: 0 } },
  { key: { key: "End" }, action: { kind: "move", to: 16 } },
  { key: { key: "PageDown" }, action: { kind: "move", to: 11 } },
  { key: { key: "PageDown" }, position: { index: 12 }, action: { kind: "move", to: 16 } },
  { key: { key: "PageUp" }, action: { kind: "move", to: 0 } },
  { key: { key: "ArrowRight" }, action: { kind: "pass" } },
  { key: { key: "ArrowLeft" }, action: { kind: "pass" } },
  { key: { key: "Backspace" }, action: { kind: "pass" } },
  { key: {}, action: { kind: "pick" } },
  { key: { key: "Tab" }, action: { kind: "pick" } },
  { key: { key: "Tab", shiftKey: true }, action: { kind: "pass" } },
  { key: { shiftKey: true }, action: { kind: "pass" } },
  { key: { metaKey: true }, action: { kind: "hold" } },
  { key: { ctrlKey: true }, action: { kind: "hold" } },
  { key: { isComposing: true }, action: { kind: "pass" } },
  { key: { keyCode: 229 }, action: { kind: "pass" } },
  { key: { key: "n" }, action: { kind: "pass" } },
])("an open menu reads $key as $action.kind", (row) => {
  expect(menuKey({ ...KEY, ...row.key }, { ...ROOT, ...row.position })).toEqual(row.action);
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
  readonly fresh: boolean;
  readonly live: readonly ComposerSuggestion[];
  readonly active: string;
  readonly pick: MenuPick;
}>([
  {
    name: "the active shown row",
    fresh: true,
    live: [],
    active: "echo",
    pick: { kind: "accept", suggestion: suggestion("echo") },
  },
  {
    name: "the active row while the shown rows lag, if the live rows hold it",
    fresh: false,
    live: [suggestion("foxtrot"), suggestion("echo")],
    active: "echo",
    pick: { kind: "accept", suggestion: suggestion("echo") },
  },
  {
    name: "nothing, selecting the first live row, when the live rows lost the active one",
    fresh: false,
    live: [suggestion("foxtrot")],
    active: "echo",
    pick: { kind: "select", id: "foxtrot" },
  },
  {
    name: "nothing when the typed query matches nothing",
    fresh: false,
    live: [],
    active: "echo",
    pick: { kind: "hold" },
  },
])("Enter picks $name", (row) => {
  expect(pickFor(row.fresh, SHOWN, row.active, () => row.live)).toEqual(row.pick);
});
