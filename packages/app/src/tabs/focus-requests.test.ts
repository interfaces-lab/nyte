import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import type { Layout, LayoutAction, PaneId } from "../panes/layout.ts";
import type { PaneCommand } from "../panes/pane-commands.ts";
import type { PaneContent } from "../panes/pane-kinds.ts";
import { chatPanes } from "../panes/pane-layout.ts";
import type { DropPlacement } from "../panes/pane-layout.ts";
import { focusRequests, tabLayout } from "./model.ts";
import type { WindowAction, WindowState } from "./model.ts";
import { windowTabs } from "./window-tabs.ts";

const A = asId<"session">("A");

const B = asId<"session">("B");

const C = asId<"session">("C");

/** What a row does to the window, by tab and pane index, through the window's real entry points. */
interface Act {
  window(action: (state: WindowState) => WindowAction): void;
  show(tab: number, sessionId: SessionId): void;
  showIn(tab: number, pane: number, sessionId: SessionId): void;
  split(tab: number): void;
  close(tab: number, pane: number): void;
  drop(tab: number, sessionId: SessionId, pane: number, placement: DropPlacement): void;
  hide(tab: number, sessionId: SessionId): void;
  newChat(tab: number): void;
  beside(sessionId: SessionId): void;
  arrange(
    tab: number,
    actions: (layout: Layout<PaneContent>) => readonly LayoutAction<PaneContent>[],
  ): void;
}

type Step = (act: Act) => void;

function tabId(index: number): string {
  const tab = windowTabs.getSnapshot().tabs[index];

  if (tab === undefined) throw new Error(`No tab ${String(index)}`);

  return tab.id;
}

function panes(index: number): readonly PaneId[] {
  const tab = windowTabs.getSnapshot().tabs[index];

  return tab === undefined ? [] : chatPanes(tabLayout(tab)).map((entry) => entry.pane);
}

function layoutAt(index: number): Layout<PaneContent> {
  const tab = windowTabs.getSnapshot().tabs[index];

  if (tab === undefined) throw new Error(`No tab ${String(index)}`);

  return tabLayout(tab);
}

function paneAt(tab: number, index: number): PaneId {
  const pane = panes(tab)[index];

  if (pane === undefined) throw new Error(`No pane ${String(index)} in tab ${String(tab)}`);

  return pane;
}

let sent: { readonly before: WindowState; readonly action: WindowAction } | undefined;

function lastSent(): typeof sent {
  return sent;
}

function send(action: WindowAction): void {
  sent = { before: windowTabs.getSnapshot(), action };
  windowTabs.dispatch(action);
}

function command(tab: number, pane: PaneCommand): void {
  send({ kind: "pane", tabId: tabId(tab), command: pane });
}

const act: Act = {
  window: (action) => send(action(windowTabs.getSnapshot())),
  show: (tab, sessionId) =>
    command(tab, { kind: "show", selection: { kind: "session", sessionId } }),
  showIn: (tab, pane, sessionId) =>
    command(tab, {
      kind: "show-in",
      pane: paneAt(tab, pane),
      selection: { kind: "session", sessionId },
    }),
  split: (tab) => command(tab, { kind: "split", direction: "right" }),
  close: (tab, pane) => command(tab, { kind: "close", pane: paneAt(tab, pane) }),
  drop: (tab, sessionId, pane, placement) =>
    command(tab, { kind: "drop", sessionId, pane: paneAt(tab, pane), placement }),
  hide: (tab, sessionId) => {
    windowTabs.store.hide(tabId(tab), sessionId);
  },
  newChat: (tab) => windowTabs.store.newChat(tabId(tab)),
  beside: (sessionId) => send({ kind: "open-beside", sessionId }),
  arrange: (tab, actions) =>
    windowTabs.store.tab(tabId(tab)).layout.dispatch(...actions(layoutAt(tab))),
};

/** Starts each row from one blank tab, whatever the rows before it left. */
function reset(): void {
  windowTabs.dispatch({ kind: "new-tab" });
  windowTabs.dispatch({ kind: "close-others", tabId: windowTabs.getSnapshot().activeTabId });
}

function listen(onRequest: (tabId: string, pane: PaneId) => void): () => void {
  const stops = windowTabs
    .getSnapshot()
    .tabs.map((tab) => windowTabs.store.onFocusRequest(tab.id, (pane) => onRequest(tab.id, pane)));

  return () => {
    for (const stop of stops) stop();
  };
}

/**
 * Draws each tab as its panes' chats, the focused pane marked `>`, the active tab in brackets:
 * `[A|>B] / C`.
 */
function drawWindow(state: WindowState): string {
  return state.tabs
    .map((tab) => {
      const layout = tabLayout(tab);

      const drawn = chatPanes(layout)
        .map(
          (entry) =>
            `${entry.pane === layout.focus[0] ? ">" : ""}${entry.selection.kind === "session" ? entry.selection.sessionId : entry.selection.kind}`,
        )
        .join("|");

      return tab.id === state.activeTabId ? `[${drawn}]` : drawn;
    })
    .join(" / ");
}

function label(state: WindowState, requested: { readonly tabId: string; readonly pane: PaneId }) {
  const index = state.tabs.findIndex((tab) => tab.id === requested.tabId);
  const tab = state.tabs[index];

  if (tab === undefined) return `gone ${requested.tabId}`;

  return `${String(index)}:${String(chatPanes(tabLayout(tab)).findIndex((entry) => entry.pane === requested.pane))}`;
}

const twoPanes: Step = (row) => {
  row.show(0, A);
  row.split(0);
  row.show(0, B);
};

const secondTab =
  (first: Step, sessionId: SessionId): Step =>
  (row) => {
    first(row);
    row.window(() => ({ kind: "new-tab" }));
    row.show(1, sessionId);
  };

const blank: Step = () => undefined;

const one: Step = (row) => row.show(0, A);

test.each<[string, Step, Step, string, readonly string[]]>([
  [
    "show a chat in a blank pane: its new pane tab",
    blank,
    (row) => row.show(0, A),
    "[>A]",
    ["0:0"],
  ],
  ["show the chat the pane shows: none", one, (row) => row.show(0, A), "[>A]", []],
  ["show-in a pane: that pane", twoPanes, (row) => row.showIn(0, 0, C), "[>C|B]", ["0:0"]],
  ["split: the new pane", one, (row) => row.split(0), "[A|>blank]", ["0:1"]],
  ["close one of two panes: the pane left", twoPanes, (row) => row.close(0, 1), "[>A]", ["0:0"]],
  [
    "drop beside a pane: the dropped chat",
    one,
    (row) => row.drop(0, B, 0, "right"),
    "[A|>B]",
    ["0:1"],
  ],
  ["hide a chat: none", twoPanes, (row) => row.hide(0, A), "[blank|>B]", []],
  [
    "new chat where one waits: the focused pane, unchanged",
    blank,
    (row) => row.newChat(0),
    "[>blank]",
    ["0:0"],
  ],
  [
    "arrange focus: none, the pane focused itself",
    twoPanes,
    (row) =>
      row.arrange(0, (layout) =>
        chatPanes(layout)
          .slice(0, 1)
          .map((entry) => ({ kind: "focus", pane: entry.pane })),
      ),
    "[>A|B]",
    [],
  ],
  [
    "arrange resize: none",
    twoPanes,
    (row) =>
      row.arrange(0, (layout) =>
        layout.root.kind === "split"
          ? [{ kind: "resize", split: layout.root.id, sizes: [0.3, 0.7] }]
          : [],
      ),
    "[A|>B]",
    [],
  ],
  [
    "open here into the chat tab: its focused pane",
    blank,
    (row) =>
      row.window(() => ({
        kind: "open",
        place: { kind: "session", sessionId: A },
        target: "here",
      })),
    "[>A]",
    ["0:0"],
  ],
  [
    "open a chat in another tab's unfocused pane: that tab's focused pane",
    (row) => {
      twoPanes(row);
      row.window(() => ({ kind: "new-tab" }));
    },
    (row) =>
      row.window(() => ({
        kind: "open",
        place: { kind: "session", sessionId: A },
        target: "here",
      })),
    "[>A|B] / >blank",
    ["0:0"],
  ],
  [
    "close-chats collapsing the active tab's split: its focused pane",
    twoPanes,
    (row) => row.window(() => ({ kind: "close-chats", sessionIds: new Set([B]) })),
    "[>A]",
    ["0:0"],
  ],
  [
    "close-chats collapsing a background tab's split: that tab's focused pane",
    secondTab(twoPanes, C),
    (row) => row.window(() => ({ kind: "close-chats", sessionIds: new Set([B]) })),
    ">A / [>C]",
    ["0:0"],
  ],
  [
    "close-chats emptying a tab: none",
    secondTab(one, B),
    (row) => row.window(() => ({ kind: "close-chats", sessionIds: new Set([A]) })),
    "[>B]",
    [],
  ],
  [
    "activate-tab: none, the mount focuses",
    secondTab(one, B),
    (row) => row.window((state) => ({ kind: "activate-tab", tabId: state.tabs[0]?.id ?? "" })),
    "[>A] / >B",
    [],
  ],
  ["new-tab: none", one, (row) => row.window(() => ({ kind: "new-tab" })), ">A / [>blank]", []],
  [
    "reopen-tab: none",
    (row) => {
      secondTab(one, B)(row);
      row.window((state) => ({ kind: "close-tab", tabId: state.tabs[0]?.id ?? "" }));
    },
    (row) => row.window(() => ({ kind: "reopen-tab" })),
    "[>A] / >B",
    [],
  ],
  [
    "keep-tab: none",
    one,
    (row) => row.window((state) => ({ kind: "keep-tab", tabId: state.activeTabId })),
    "[>A]",
    [],
  ],
  [
    "open beside a chat another tab shows: its new pane here; the emptied tab closes",
    secondTab(one, B),
    (row) => row.beside(A),
    "[B|>A]",
    ["0:1"],
  ],
  [
    "drop a chat out of another tab's split: that tab's focused pane, then the dropped chat",
    secondTab(twoPanes, C),
    (row) => row.drop(1, B, 0, "right"),
    ">A / [C|>B]",
    ["0:0", "1:1"],
  ],
])("%s", (_name, setup, step, after, requested) => {
  reset();
  setup(act);
  const requests: { readonly tabId: string; readonly pane: PaneId }[] = [];
  const stop = listen((id, pane) => requests.push({ tabId: id, pane }));
  sent = undefined;
  step(act);
  stop();
  const state = windowTabs.getSnapshot();

  expect({
    after: drawWindow(state),
    requested: requests.map((entry) => label(state, entry)),
  }).toEqual({
    after,
    requested,
  });

  const last = lastSent();

  if (last === undefined) return;
  const decided = [...focusRequests(last.before, state, last.action)];
  expect(decided.map(([id, pane]) => label(state, { tabId: id, pane }))).toEqual(requested);
});
