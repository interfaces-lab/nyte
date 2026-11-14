import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import { WindowDrafts } from "../chat/composer/drafts.ts";
import { planPane } from "../panes/pane-commands.ts";
import type { PaneCommand } from "../panes/pane-commands.ts";
import { chatContent, chatPanes } from "../panes/pane-layout.ts";
import type { DropPlacement, PaneSelection } from "../panes/pane-layout.ts";
import {
  changePanes,
  focusFirst,
  noDrafts,
  showIn,
  splitRight,
  tabPanes,
} from "../../test/panes.ts";
import type { PaneChange } from "../../test/panes.ts";
import { activeTab, initialWindow, reduce, tabLayout, tabPlace, withoutPreviews } from "./model.ts";
import type { Place, WindowAction, WindowState } from "./model.ts";
import { WindowStore } from "./window-store.ts";

let lastId = 1;

function createId(): string {
  lastId += 1;

  return `t${String(lastId)}`;
}

function run(actions: readonly WindowAction[], state = initialWindow("t1", createId)): WindowState {
  return actions.reduce((current, action) => reduce(current, action, createId, noDrafts), state);
}

const chat = (id: string): PaneSelection => ({ kind: "session", sessionId: asId<"session">(id) });

const customize: Place = { kind: "customize", section: undefined, sessionId: undefined };

const places = (state: WindowState): readonly Place[] => state.tabs.map((tab) => tabPlace(tab));

function pane(state: WindowState, change: PaneChange): WindowAction {
  return changePanes(state, change);
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

  state = run([pane(state, splitRight)], state);
  state = run([pane(state, showIn(chat("c")))], state);
  state = run([pane(state, focusFirst)], state);
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
      pane(state, focusFirst),
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

  expect(previews(run([pane(state, splitRight)], state))).toEqual([false, false]);

  const dropped = run(
    [
      pane(state, (layout) =>
        chatPanes(layout).map((shown) => ({
          kind: "set-content",
          tab: shown.tab,
          content: chatContent(chat("b")),
        })),
      ),
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

  state = run([pane(state, splitRight)], state);
  state = run([pane(state, showIn(chat("c")))], state);

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
  const left = activeTab(gone).view;

  expect(left.kind === "page" ? "page" : left.layout.root.kind, "the split became one pane").toBe(
    "pane",
  );
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

const drafts = tabPanes().viewState;

/** What the sidebar's and tab strip's "Open beside" (`right`) and a drop on the focused pane do. */
function dropOnFocused(id: string, placement: DropPlacement): PaneChange {
  return (layout) =>
    planPane(
      layout,
      { kind: "drop", sessionId: asId<"session">(id), pane: layout.focus[0], placement },
      (paneId) => drafts.readBlank(paneId),
    ).actions;
}

const label = (place: Place): string => (place.kind === "session" ? place.sessionId : place.kind);

test.each<[string, readonly (WindowAction | PaneChange)[], readonly string[][], string]>([
  [
    "open beside a chat another tab shows moves it here and closes that tab",
    [
      { kind: "open", place: chat("a"), target: "permanent" },
      { kind: "open", place: chat("b"), target: "permanent" },
      dropOnFocused("a", "right"),
    ],
    [["b", "a"]],
    "a",
  ],
  [
    "a click on the moved chat then shows the split it is in",
    [
      { kind: "open", place: chat("a"), target: "permanent" },
      { kind: "open", place: chat("b"), target: "permanent" },
      dropOnFocused("a", "right"),
      { kind: "open", place: chat("a"), target: "permanent" },
    ],
    [["b", "a"]],
    "a",
  ],
  [
    "a center drop of a chat another tab shows replaces this pane's chat",
    [
      { kind: "open", place: chat("a"), target: "permanent" },
      { kind: "open", place: chat("b"), target: "permanent" },
      dropOnFocused("a", "center"),
    ],
    [["a"]],
    "a",
  ],
  [
    "the split a chat moves out of keeps its other chat",
    [
      { kind: "open", place: chat("a"), target: "permanent" },
      splitRight,
      showIn(chat("c")),
      { kind: "open", place: chat("b"), target: "permanent" },
      dropOnFocused("a", "bottom"),
    ],
    [["c"], ["b", "a"]],
    "a",
  ],
  [
    "a drop with no room for another pane leaves the chat in its tab",
    [
      { kind: "open", place: chat("a"), target: "permanent" },
      { kind: "open", place: chat("b"), target: "permanent" },
      ...Array.from({ length: 5 }, () => splitRight),
      dropOnFocused("a", "right"),
    ],
    [["a"], ["b", "blank", "blank", "blank", "blank", "blank"]],
    "blank",
  ],
  [
    "reopening a tab whose chat is open again activates the tab that has it",
    [
      { kind: "open", place: chat("a"), target: "permanent" },
      { kind: "open", place: chat("b"), target: "permanent" },
      { kind: "close-tab", tabId: "t1" },
      { kind: "open", place: chat("a"), target: "permanent" },
      { kind: "reopen-tab" },
    ],
    [["b"], ["a"]],
    "a",
  ],
  [
    "reopening a split brings back only the chats no other tab has",
    [
      { kind: "open", place: chat("a"), target: "permanent" },
      splitRight,
      showIn(chat("c")),
      { kind: "close-tab", tabId: "t1" },
      { kind: "open", place: chat("a"), target: "permanent" },
      { kind: "reopen-tab" },
    ],
    [["c"], ["a"]],
    "c",
  ],
  [
    "reopening a tab whose chats are all closed brings it back whole",
    [
      { kind: "open", place: chat("a"), target: "permanent" },
      splitRight,
      showIn(chat("c")),
      { kind: "open", place: chat("b"), target: "permanent" },
      { kind: "close-tab", tabId: "t1" },
      { kind: "reopen-tab" },
    ],
    [["a", "c"], ["b"]],
    "c",
  ],
])("one tab per chat: %s", (_, steps, tabs, active) => {
  const state = steps.reduce(
    (current, step) =>
      reduce(current, "kind" in step ? step : pane(current, step), createId, noDrafts),
    initialWindow("t1", createId),
  );

  expect(
    state.tabs.map((tab) => chatPanes(tabLayout(tab)).map((shown) => label(shown.selection))),
  ).toEqual(tabs);
  expect(label(tabPlace(activeTab(state)))).toBe(active);
  expect(state.closed, "a chat that moved or came back isn't offered again").toEqual([]);
});

type Window = WindowStore;

const openChat =
  (id: string) =>
  (store: Window): void =>
    store.dispatch({ kind: "open", place: chat(id), target: "permanent" });

const inActiveTab =
  (command: (layout: ReturnType<typeof tabLayout>) => PaneCommand) =>
  (store: Window): void => {
    const tab = activeTab(store.getSnapshot());
    store.run(tab.id, command(tabLayout(tab)));
  };

/** What deleting a chat does here: its rows' and title bar's Delete hide it, with an undo. */
const deleteChat =
  (id: string, undo = false) =>
  (store: Window): void => {
    const restore = store.hide(asId<"session">(id));

    if (undo) restore();
  };

/** The delete's Undo, pressed after whatever came between. */
const undoDelete =
  (id: string) =>
  (store: Window): void =>
    store.dispatch({ kind: "unhide-chat", sessionId: asId<"session">(id) });

const gone =
  (...ids: readonly string[]) =>
  (store: Window): void =>
    store.dispatch({
      kind: "close-chats",
      sessionIds: new Set(ids.map((id) => asId<"session">(id))),
    });

const closeOthers =
  (id: string) =>
  (store: Window): void => {
    const kept = store.getSnapshot().tabs.find((tab) => label(tabPlace(tab)) === id);

    if (kept === undefined) throw new Error(`No tab shows ${id}`);
    store.dispatch({ kind: "close-others", tabId: kept.id });
  };

const openNextToParent =
  (id: string) =>
  (store: Window): void =>
    store.dispatch({ kind: "open", place: chat(id), target: "next-to-parent" });

const typeInBlank = (store: Window): void => {
  const state = store.getSnapshot();
  const tab = activeTab(state);
  const blankPane = chatPanes(tabLayout(tab)).find((shown) => shown.selection.kind === "blank");

  if (blankPane === undefined) throw new Error("No blank pane to type in");
  const drafts = store.viewState(tab.id);
  const draft = drafts.readBlank(blankPane.pane);
  drafts.writeBlank(blankPane.pane, {
    ...draft,
    composer: { ...draft.composer, draft: "Keep", selectionStart: 4, selectionEnd: 4 },
  });
};

/** [a] [b|c], with c's pane focused in the active tab. */
const splitWindow = [
  openChat("a"),
  openChat("b"),
  inActiveTab(() => ({ kind: "split", direction: "right" })),
  inActiveTab(() => ({ kind: "show", selection: chat("c") })),
];

test.each<
  [string, readonly ((store: Window) => void)[], readonly string[][], string, readonly string[]]
>([
  [
    "a chat deleted in a background tab is hidden there while the undo waits (D7)",
    [openChat("a"), openChat("b"), deleteChat("a")],
    [["blank"], ["b"]],
    "b",
    ["a"],
  ],
  [
    "undo brings it back in that tab",
    [openChat("a"), openChat("b"), deleteChat("a", true)],
    [["a"], ["b"]],
    "b",
    [],
  ],
  [
    "undo after the chat was reopened in another tab leaves it there and the blank as it is",
    [openChat("a"), openChat("b"), deleteChat("a"), openChat("a"), undoDelete("a")],
    [["blank"], ["b"], ["a"]],
    "a",
    [],
  ],
  [
    "undo of a chat deleted twice brings it back where it was deleted last, closing no tab",
    [
      openChat("a"),
      openChat("b"),
      deleteChat("a"),
      openChat("a"),
      deleteChat("a"),
      undoDelete("a"),
    ],
    [["blank"], ["b"], ["a"]],
    "a",
    [],
  ],
  [
    "the delete committing closes the tab it left blank, as a delete elsewhere does",
    [openChat("a"), openChat("b"), deleteChat("a"), gone("a")],
    [["b"]],
    "b",
    [],
  ],
  [
    "the chat shown here, once deleted, closes its tab like any other (D7)",
    [openChat("a"), openChat("b"), deleteChat("b"), gone("b")],
    [["a"]],
    "a",
    [],
  ],
  [
    "a split keeps its other chat once the delete commits (D7)",
    [...splitWindow, deleteChat("b"), gone("b")],
    [["a"], ["c"]],
    "c",
    [],
  ],
  [
    "while the undo waits, the split shows a blank where the chat was",
    [...splitWindow, deleteChat("b")],
    [["a"], ["blank", "c"]],
    "c",
    ["b"],
  ],
  [
    "a blank pane typed in after the delete stays when it commits",
    [
      ...splitWindow,
      deleteChat("b"),
      inActiveTab((layout) => ({
        kind: "focus",
        pane: chatPanes(layout)[0]?.pane ?? layout.focus[0],
      })),
      typeInBlank,
      gone("b"),
    ],
    [["a"], ["blank", "c"]],
    "blank",
    [],
  ],
  [
    "a chat deleted elsewhere closes the same panes, with no undo",
    [...splitWindow, gone("b", "a")],
    [["c"]],
    "c",
    [],
  ],
  [
    "a tab closed while the undo waits leaves nothing for the undo to fill",
    [openChat("a"), openChat("b"), deleteChat("b"), closeOthers("a")],
    [["a"]],
    "a",
    [],
  ],
  [
    "a blank tab the next chat reuses leaves nothing for the undo to fill",
    [openChat("b"), deleteChat("b"), openNextToParent("c")],
    [["c"]],
    "c",
    [],
  ],
])("a chat going away: %s", (_, steps, tabs, active, waiting) => {
  const drafts = new WindowDrafts();
  const store = new WindowStore(initialWindow("t1", createId), () => drafts);

  for (const step of steps) step(store);
  const state = store.getSnapshot();

  expect(
    state.tabs.map((tab) => chatPanes(tabLayout(tab)).map((shown) => label(shown.selection))),
  ).toEqual(tabs);
  expect(label(tabPlace(activeTab(state)))).toBe(active);
  expect(state.closed, "a deleted chat's tab is not offered again").toEqual([]);
  expect(state.hidden.map((entry) => entry.sessionId)).toEqual(waiting);
});

const project: Place = { kind: "project", projectId: asId<"project">("p") };

const closeActive = (state: WindowState): WindowAction => ({
  kind: "close-tab",
  tabId: state.activeTabId,
});

test.each<[string, Place, readonly (WindowAction | typeof closeActive)[], readonly Place[], Place]>(
  [
    [
      "reopening Customize while Customize is open activates its tab",
      { ...customize, section: "skills" },
      [
        closeActive,
        { kind: "open", place: customize, target: "permanent" },
        { kind: "activate-index", index: 0 },
        { kind: "reopen-tab" },
      ],
      [chat("a"), { ...customize, section: "skills" }],
      { ...customize, section: "skills" },
    ],
    [
      "reopening a project while it is open activates its tab",
      project,
      [
        closeActive,
        { kind: "open", place: project, target: "permanent" },
        { kind: "activate-index", index: 0 },
        { kind: "reopen-tab" },
      ],
      [chat("a"), project],
      project,
    ],
    [
      "reopening a page that is closed brings its tab back",
      project,
      [closeActive, { kind: "reopen-tab" }],
      [chat("a"), project],
      project,
    ],
  ],
)("one tab per page: %s", (_, page, steps, tabs, active) => {
  const opened = run([
    { kind: "open", place: chat("a"), target: "permanent" },
    { kind: "open", place: page, target: "permanent" },
  ]);

  const state = steps.reduce(
    (current, step) => run(["kind" in step ? step : step(current)], current),
    opened,
  );

  expect(places(state)).toEqual(tabs);
  expect(tabPlace(activeTab(state))).toEqual(active);
  expect(state.closed).toEqual([]);
});
