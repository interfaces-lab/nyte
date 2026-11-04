import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import { reducePaneLayout } from "../panes/pane-layout.ts";
import type { PaneLayoutAction, PaneSelection } from "../panes/pane-layout.ts";
import { activeTab, initialWindow, reduce, tabLayout, tabPlace, withoutPreviews } from "./model.ts";
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
    { kind: "open", place: chat("a"), target: "permanent" },
    { kind: "open", place: chat("b"), target: "permanent" },
  ]);

  expect(places(state), "the window's new chat took the first").toEqual([chat("a"), chat("b")]);
  expect(tabPlace(activeTab(state))).toEqual(chat("b"));
});

test("opening a place that has a tab switches to it and focuses its pane", () => {
  let state = run([
    { kind: "open", place: chat("a"), target: "permanent" },
    { kind: "open", place: chat("b"), target: "permanent" },
  ]);

  state = run([pane(state, { kind: "split", direction: "right" })], state);
  state = run([pane(state, { kind: "select", selection: chat("c") })], state);
  state = run([pane(state, { kind: "focus", paneId: "primary" })], state);
  state = run([{ kind: "activate-index", index: 0 }], state);

  const again = run([{ kind: "open", place: chat("c"), target: "permanent" }], state);
  expect(again.tabs).toHaveLength(state.tabs.length);
  expect(tabPlace(activeTab(again))).toEqual(chat("c"));

  const behind = run([{ kind: "open", place: chat("a"), target: "background" }], state);
  expect(behind, "a background open of an open chat changes nothing").toBe(state);
});

test("closing goes back to the tab used before it, then right, then left", () => {
  const state = run([
    { kind: "open", place: chat("a"), target: "permanent" },
    { kind: "open", place: chat("b"), target: "background" },
    { kind: "open", place: chat("c"), target: "background" },
    { kind: "activate-index", index: 2 },
    { kind: "activate-index", index: 1 },
  ]);

  expect(places(state)).toEqual([chat("a"), chat("c"), chat("b")]);

  const recent = run([{ kind: "close-tab", tabId: state.activeTabId }], state);
  expect(tabPlace(activeTab(recent))).toEqual(chat("b"));

  const fresh = run([
    { kind: "open", place: chat("a"), target: "permanent" },
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
    { kind: "open", place: chat("a"), target: "permanent" },
    { kind: "open", place: customize, target: "permanent" },
    { kind: "page-section", section: "skills" },
  ]);

  expect(places(state)).toEqual([chat("a"), { ...customize, section: "skills" }]);

  state = run([{ kind: "activate-index", index: 0 }], state);
  state = run([{ kind: "open", place: customize, target: "permanent" }], state);
  expect(tabPlace(activeTab(state))).toEqual({ ...customize, section: "skills" });

  state = run([{ kind: "leave-page" }], state);
  expect(tabPlace(activeTab(state))).toEqual(chat("a"));
});

test("reopen skips new chats and keeps twenty-five", () => {
  let state = run([
    { kind: "open", place: chat("kept"), target: "permanent" },
    { kind: "new-tab" },
  ]);

  state = run([{ kind: "close-tab", tabId: activeTab(state).id }], state);
  expect(state.closed).toEqual([]);

  for (let index = 0; index < 30; index += 1) {
    state = run([{ kind: "open", place: chat(`c${String(index)}`), target: "permanent" }], state);
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
    { kind: "open", place: chat("a"), target: "permanent" },
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

const previews = (state: WindowState): readonly boolean[] =>
  state.tabs.map((tab) => tab.view.kind === "preview");

test("a plain click shows a chat in the window's one preview tab, which the next one replaces", () => {
  const state = run([
    { kind: "open", place: chat("kept"), target: "permanent" },
    { kind: "open", place: chat("a"), target: "preview" },
  ]);

  expect(places(state)).toEqual([chat("kept"), chat("a")]);
  expect(previews(state)).toEqual([false, true]);

  const replaced = run(
    [
      { kind: "activate-index", index: 0 },
      { kind: "open", place: chat("b"), target: "preview" },
    ],
    state,
  );

  expect(places(replaced), "b takes a's slot").toEqual([chat("kept"), chat("b")]);
  expect(replaced.tabs[1]?.id).toBe(state.tabs[1]?.id);
  expect(tabPlace(activeTab(replaced))).toEqual(chat("b"));
  expect(replaced.closed, "a replaced preview isn't offered again").toEqual([]);

  const shown = run([{ kind: "open", place: chat("kept"), target: "preview" }], replaced);
  expect(previews(shown), "a chat with a tab is shown there, as it is").toEqual([false, true]);
  expect(tabPlace(activeTab(shown))).toEqual(chat("kept"));

  const waiting = run(
    [{ kind: "new-tab" }, { kind: "open", place: chat("c"), target: "preview" }],
    replaced,
  );

  expect(places(waiting), "a waiting new chat takes the preview").toEqual([
    chat("kept"),
    chat("c"),
  ]);
  expect(previews(waiting)).toEqual([false, true]);
  expect(waiting.closed).toEqual([]);

  const behind = run([{ kind: "open", place: chat("d"), target: "background" }], replaced);
  expect(places(behind)).toEqual([chat("kept"), chat("b"), chat("d")]);
  expect(previews(behind), "a modified click still opens a lasting tab").toEqual([
    false,
    true,
    false,
  ]);
});

test("a preview lasts once it's kept, dragged, split or shows another chat, not when selected", () => {
  const state = run([
    { kind: "open", place: chat("kept"), target: "permanent" },
    { kind: "open", place: chat("a"), target: "preview" },
  ]);

  const preview = activeTab(state).id;
  const ids = state.tabs.map((tab) => tab.id);

  const selected = run(
    [
      { kind: "activate-index", index: 0 },
      { kind: "activate-tab", tabId: preview },
      { kind: "cycle-tab", step: 1 },
      pane(state, { kind: "focus", paneId: "primary" }),
    ],
    state,
  );

  expect(previews(selected)).toEqual([false, true]);

  expect(previews(run([{ kind: "keep-tab", tabId: preview }], state))).toEqual([false, false]);

  const dragged = run([{ kind: "reorder", tabIds: ids.toReversed(), tabId: preview }], state);
  expect(previews(dragged)).toEqual([false, false]);

  const passed = run([{ kind: "reorder", tabIds: ids.toReversed(), tabId: "t1" }], state);
  expect(previews(passed), "another tab dragged past it leaves it a preview").toEqual([
    true,
    false,
  ]);

  expect(previews(run([pane(state, { kind: "split", direction: "right" })], state))).toEqual([
    false,
    false,
  ]);

  const dropped = run(
    [
      pane(state, {
        kind: "drop-session",
        sessionId: asId<"session">("b"),
        targetPaneId: "primary",
        placement: "center",
      }),
    ],
    state,
  );

  expect(places(dropped)).toEqual([chat("kept"), chat("b")]);
  expect(previews(dropped)).toEqual([false, false]);
});

test("a child opens as a preview after its parent, which it keeps", () => {
  const state = run([
    { kind: "open", place: chat("parent"), target: "permanent" },
    { kind: "open", place: chat("other"), target: "background" },
    { kind: "open", place: chat("child"), target: "next-to-parent" },
  ]);

  expect(places(state)).toEqual([chat("parent"), chat("child"), chat("other")]);
  expect(previews(state)).toEqual([false, true, false]);
  expect(tabPlace(activeTab(state))).toEqual(chat("child"));

  const previewed = run([
    { kind: "open", place: chat("parent"), target: "preview" },
    { kind: "open", place: chat("child"), target: "next-to-parent" },
  ]);

  expect(places(previewed), "a previewed parent stays open").toEqual([
    chat("parent"),
    chat("child"),
  ]);
  expect(previews(previewed)).toEqual([false, true]);

  const behind = run([
    { kind: "open", place: chat("a"), target: "preview" },
    { kind: "open", place: chat("parent"), target: "permanent" },
    { kind: "open", place: chat("child"), target: "next-to-parent" },
  ]);

  expect(places(behind), "a preview before the parent closes; the child goes after it").toEqual([
    chat("parent"),
    chat("child"),
  ]);
  expect(previews(behind)).toEqual([false, true]);
  expect(tabPlace(activeTab(behind))).toEqual(chat("child"));
});

test("a chat archived or deleted closes its tabs, and a split keeps its other chat", () => {
  let state = run([
    { kind: "open", place: chat("a"), target: "permanent" },
    { kind: "open", place: chat("b"), target: "permanent" },
  ]);

  state = run([pane(state, { kind: "split", direction: "right" })], state);
  state = run([pane(state, { kind: "select", selection: chat("c") })], state);

  state = run(
    [
      { kind: "open", place: chat("d"), target: "preview" },
      { kind: "activate-index", index: 0 },
    ],
    state,
  );

  const gone = run(
    [
      {
        kind: "close-chats",
        sessionIds: new Set(["a", "b", "d"].map((id) => asId<"session">(id))),
      },
    ],
    state,
  );

  expect(places(gone)).toEqual([chat("c")]);
  expect(tabLayout(activeTab(gone)).kind, "the split became one pane").toBe("single");
  expect(gone.closed, "a gone chat's tab doesn't reopen").toEqual([]);

  const elsewhere = run(
    [{ kind: "close-chats", sessionIds: new Set([asId<"session">("other")]) }],
    state,
  );

  expect(elsewhere).toBe(state);
});

test("previews don't outlast the window, and chats deleted or archived don't reopen", () => {
  const state = run([
    { kind: "open", place: chat("kept"), target: "permanent" },
    { kind: "open", place: chat("a"), target: "preview" },
  ]);

  const restarted = withoutPreviews(state, createId);
  expect(places(restarted)).toEqual([chat("kept")]);
  expect(tabPlace(activeTab(restarted))).toEqual(chat("kept"));
  expect(restarted.closed).toEqual([]);

  const alone = withoutPreviews(
    run([{ kind: "open", place: chat("a"), target: "preview" }]),
    createId,
  );

  expect(places(alone)).toEqual([{ kind: "blank" }]);

  let closed = run(
    [
      { kind: "close-tab", tabId: activeTab(state).id },
      { kind: "close-tab", tabId: "t1" },
    ],
    state,
  );

  expect(
    closed.closed.map(({ tab }) => tab.view.kind),
    "a closed preview reopens as a lasting tab",
  ).toEqual(["panes", "panes"]);

  closed = run([{ kind: "forget-closed", gone: new Set([asId<"session">("kept")]) }], closed);
  closed = run([{ kind: "reopen-tab" }, { kind: "reopen-tab" }], closed);
  expect(places(closed), "kept was deleted").toEqual([{ kind: "blank" }, chat("a")]);
  expect(previews(closed)).toEqual([false, false]);
});
