import { expect, test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import { reducePaneLayout } from "../layout/pane-layout.ts";
import type { PaneLayoutAction, PaneSelection } from "../layout/pane-layout.ts";
import { activeTab, canTravel, initialWindow, reduce, tabPlace, tabPlaces } from "./model.ts";
import type { Place, WindowAction, WindowState } from "./model.ts";

function ids(): () => string {
  let next = 1;

  return () => `t${String((next += 1))}`;
}

function run(actions: readonly WindowAction[], state = initialWindow("t1")): WindowState {
  const createId = ids();

  return actions.reduce((current, action) => reduce(current, action, createId), state);
}

const chat = (id: string): PaneSelection => ({ kind: "session", sessionId: sessionId(id) });

const customize: Place = { kind: "customize", section: undefined, sessionId: undefined };

/** What a pane controller proposes for `action` on the active tab's panes. */
function pane(state: WindowState, action: PaneLayoutAction): WindowAction {
  const view = activeTab(state).views[activeTab(state).index];

  if (view?.kind !== "panes") throw new Error("The active tab shows no panes.");

  return { kind: "layout", action, layout: reducePaneLayout(view.layout, action) };
}

test("back walks the focused pane, then returns from a page to the exact split", () => {
  let state = run([
    { kind: "open", place: chat("a"), target: "here" },
    { kind: "open", place: chat("b"), target: "here" },
  ]);

  state = run([pane(state, { kind: "split", direction: "right" })], state);
  state = run([{ kind: "open", place: chat("c"), target: "here" }], state);
  const split = activeTab(state).views[activeTab(state).index];
  state = run([{ kind: "open", place: customize, target: "here" }], state);
  expect(tabPlace(activeTab(state)).kind).toBe("customize");

  state = run([{ kind: "travel", step: -1 }], state);
  expect(activeTab(state).views[activeTab(state).index]).toBe(split);
  expect(tabPlaces(activeTab(state))).toEqual([chat("c"), chat("b")]);

  // The new pane's own entries come first: c, then the new chat it started as.
  state = run([{ kind: "travel", step: -1 }], state);
  expect(tabPlace(activeTab(state))).toEqual({ kind: "blank" });
  expect(canTravel(state, -1)).toBe(false);

  state = run([pane(state, { kind: "focus", paneId: "primary" })], state);
  state = run([{ kind: "travel", step: -1 }], state);
  expect(tabPlace(activeTab(state))).toEqual(chat("a"));
  state = run([{ kind: "travel", step: 1 }], state);
  expect(tabPlace(activeTab(state))).toEqual(chat("b"));
});

test("a new chat that starts its chat is replaced, not stacked", () => {
  const state = run([]);

  const started = run(
    [pane(state, { kind: "select-in-pane", paneId: "primary", selection: chat("a") })],
    state,
  );

  expect(tabPlace(activeTab(started))).toEqual(chat("a"));
  expect(canTravel(started, -1)).toBe(false);
});

test("closing hands over right, then left, never to a pinned tab", () => {
  const state = run([
    { kind: "open", place: chat("a"), target: "here" },
    { kind: "open", place: chat("b"), target: "background" },
    { kind: "open", place: chat("c"), target: "background" },
    { kind: "activate-index", index: 1 },
  ]);

  expect(state.tabs.map((tab) => tabPlace(tab))).toEqual([chat("a"), chat("c"), chat("b")]);

  const right = run([{ kind: "close-tab", tabId: state.activeTabId }], state);
  expect(tabPlace(activeTab(right))).toEqual(chat("b"));

  const pinned = run(
    [
      { kind: "toggle-pin", tabId: "t1" },
      { kind: "activate-index", index: 2 },
      { kind: "close-tab", tabId: state.tabs[2]?.id ?? "" },
    ],
    state,
  );

  expect(tabPlace(activeTab(pinned))).toEqual(chat("c"));

  const alone = run([{ kind: "close-others", tabId: "t1" }], pinned);
  expect(alone.tabs.map((tab) => tab.pinned)).toEqual([true, false]);
  expect(tabPlace(activeTab(alone))).toEqual({ kind: "blank" });
});

test("a pinned tab keeps its place and opens what it is asked to past the pinned group", () => {
  let state = run([
    { kind: "open", place: chat("a"), target: "here" },
    { kind: "open", place: chat("b"), target: "background" },
    { kind: "toggle-pin", tabId: "t1" },
  ]);

  state = run([pane(state, { kind: "select", selection: chat("c") })], state);

  expect(state.tabs.map((tab) => tabPlace(tab))).toEqual([chat("a"), chat("c"), chat("b")]);
  expect(activeTab(state).id).toBe(state.tabs[1]?.id);

  state = run([{ kind: "activate-tab", tabId: "t1" }], state);
  state = run([pane(state, { kind: "split", direction: "right" })], state);
  expect(tabPlaces(activeTab(state))).toEqual([chat("a")]);
  expect(canTravel(state, -1)).toBe(false);
  expect(run([{ kind: "close-right", tabId: "t1" }], state).tabs).toHaveLength(1);
});

test("reopen skips untouched new chats and keeps twenty-five", () => {
  let state = run([{ kind: "open", place: chat("kept"), target: "here" }, { kind: "new-tab" }]);
  state = run([{ kind: "close-tab", tabId: activeTab(state).id }], state);
  expect(state.closed).toEqual([]);

  for (let index = 0; index < 30; index += 1) {
    state = run([{ kind: "open", place: chat(`c${String(index)}`), target: "foreground" }], state);
    state = run([{ kind: "close-tab", tabId: activeTab(state).id }], state);
  }

  expect(state.closed).toHaveLength(25);
  state = run([{ kind: "reopen-tab" }], state);
  expect(tabPlace(activeTab(state))).toEqual(chat("c29"));
});

test("tab shortcuts address the ninth tab and wrap when cycling", () => {
  const state = run(Array.from({ length: 10 }, (): WindowAction => ({ kind: "new-tab" })));
  const ninth = run([{ kind: "activate-index", index: 8 }], state);
  expect(ninth.activeTabId).toBe(state.tabs[8]?.id);

  const first = run([{ kind: "activate-index", index: 0 }], state);
  expect(run([{ kind: "cycle-tab", step: -1 }], first).activeTabId).toBe(state.tabs.at(-1)?.id);
  expect(run([{ kind: "cycle-tab", step: 1 }], state).activeTabId).toBe(state.tabs[0]?.id);
});
