import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import { reducePaneLayout } from "../layout/pane-layout.ts";
import type { PaneLayoutAction, PaneSelection } from "../layout/pane-layout.ts";
import { activeTab, initialWindow, reduce, tabLayout, tabPlace } from "./model.ts";
import type { Place, WindowAction, WindowState } from "./model.ts";

let lastId = 1;

function createId(): string {
  lastId += 1;

  return `t${String(lastId)}`;
}

function run(actions: readonly WindowAction[], state = initialWindow("t1")): WindowState {
  return actions.reduce((current, action) => reduce(current, action, createId), state);
}

const chat = (id: string): PaneSelection => ({ kind: "session", sessionId: asId<"session">(id) });

const customize: Place = { kind: "customize", section: undefined, sessionId: undefined };

const places = (state: WindowState): readonly Place[] => state.tabs.map((tab) => tabPlace(tab));

function pane(state: WindowState, action: PaneLayoutAction): WindowAction {
  const tab = activeTab(state);

  return { kind: "layout", tabId: tab.id, layout: reducePaneLayout(tabLayout(tab), action) };
}

test("a click opens a chat in its own tab, using a new chat tab it is opened from", () => {
  const state = run([
    { kind: "open", place: chat("a"), target: "foreground" },
    { kind: "open", place: chat("b"), target: "foreground" },
  ]);

  expect(places(state), "the window's new chat took the first").toEqual([chat("a"), chat("b")]);
  expect(tabPlace(activeTab(state))).toEqual(chat("b"));
});

test("opening a place that has a tab switches to it and focuses its pane", () => {
  let state = run([
    { kind: "open", place: chat("a"), target: "foreground" },
    { kind: "open", place: chat("b"), target: "foreground" },
  ]);

  state = run([pane(state, { kind: "split", direction: "right" })], state);
  state = run([pane(state, { kind: "select", selection: chat("c") })], state);
  state = run([pane(state, { kind: "focus", paneId: "primary" })], state);
  state = run([{ kind: "activate-index", index: 0 }], state);

  const again = run([{ kind: "open", place: chat("c"), target: "foreground" }], state);
  expect(again.tabs).toHaveLength(state.tabs.length);
  expect(tabPlace(activeTab(again))).toEqual(chat("c"));

  const behind = run([{ kind: "open", place: chat("a"), target: "background" }], state);
  expect(behind, "a background open of an open chat changes nothing").toBe(state);
});

test("closing goes back to the tab used before it, then right, then left", () => {
  const state = run([
    { kind: "open", place: chat("a"), target: "foreground" },
    { kind: "open", place: chat("b"), target: "background" },
    { kind: "open", place: chat("c"), target: "background" },
    { kind: "activate-index", index: 2 },
    { kind: "activate-index", index: 1 },
  ]);

  expect(places(state)).toEqual([chat("a"), chat("c"), chat("b")]);

  const recent = run([{ kind: "close-tab", tabId: state.activeTabId }], state);
  expect(tabPlace(activeTab(recent))).toEqual(chat("b"));

  const fresh = run([
    { kind: "open", place: chat("a"), target: "foreground" },
    { kind: "open", place: chat("b"), target: "background" },
    { kind: "close-tab", tabId: "t1" },
  ]);

  expect(tabPlace(activeTab(fresh)), "with nothing used before, the right neighbour").toEqual(
    chat("b"),
  );

  const alone = run([{ kind: "close-others", tabId: state.activeTabId }], state);
  expect(places(alone)).toEqual([chat("c")]);
});

test("pages open in their own tab, keep their section, and close like chats", () => {
  let state = run([
    { kind: "open", place: chat("a"), target: "foreground" },
    { kind: "open", place: customize, target: "foreground" },
    { kind: "page-section", section: "skills" },
  ]);

  expect(places(state)).toEqual([chat("a"), { ...customize, section: "skills" }]);

  state = run([{ kind: "activate-index", index: 0 }], state);
  state = run([{ kind: "open", place: customize, target: "foreground" }], state);
  expect(tabPlace(activeTab(state))).toEqual({ ...customize, section: "skills" });

  state = run([{ kind: "leave-page" }], state);
  expect(tabPlace(activeTab(state))).toEqual(chat("a"));
});

test("reopen skips new chats and keeps twenty-five", () => {
  let state = run([
    { kind: "open", place: chat("kept"), target: "foreground" },
    { kind: "new-tab" },
  ]);

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

test("a new chat goes to the tab already showing one, or to a new tab", () => {
  const state = run([{ kind: "new-tab" }, { kind: "new-tab" }]);
  expect(state.tabs).toHaveLength(1);

  const opened = run([
    { kind: "open", place: chat("a"), target: "foreground" },
    { kind: "new-tab" },
  ]);

  expect(places(opened)).toEqual([chat("a"), { kind: "blank" }]);
  expect(tabPlace(activeTab(opened))).toEqual({ kind: "blank" });

  const waiting = run([
    { kind: "open", place: chat("a"), target: "background" },
    { kind: "activate-index", index: 1 },
    { kind: "new-tab" },
  ]);

  expect(places(waiting), "the waiting new chat is reused, not doubled").toEqual([
    { kind: "blank" },
    chat("a"),
  ]);
  expect(waiting.activeTabId).toBe("t1");
});

test("tab shortcuts address the ninth tab and wrap when cycling", () => {
  const state = run(
    Array.from({ length: 10 }, (_, index): WindowAction => ({
      kind: "open",
      place: chat(String(index)),
      target: "background",
    })),
  );

  const ninth = run([{ kind: "activate-index", index: 8 }], state);
  expect(ninth.activeTabId).toBe(state.tabs[8]?.id);

  const first = run([{ kind: "activate-index", index: 0 }], state);
  expect(run([{ kind: "cycle-tab", step: -1 }], first).activeTabId).toBe(state.tabs.at(-1)?.id);
  expect(run([{ kind: "cycle-tab", step: 1 }], state).activeTabId).toBe(state.tabs[1]?.id);
});
