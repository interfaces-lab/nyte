import type { SessionId } from "@nyte-ai/sdk";
import { createLayout, reduceLayout } from "../panes/layout.ts";
import type { Layout } from "../panes/layout.ts";
import { paneRules } from "../panes/pane-kinds.ts";
import type { PaneContent } from "../panes/pane-kinds.ts";
import {
  activeSelection,
  chatContent,
  chatPanes,
  findSessionTab,
  sameSelection,
  showChat,
} from "../panes/pane-layout.ts";
import type { PaneSelection } from "../panes/pane-layout.ts";

/** A page has its own tab. `section` is Customize's section, or a project's id, or `new`. */
export type Page = {
  readonly kind: "customize" | "project";
  readonly section: string | undefined;
  readonly sessionId: SessionId | undefined;
};

export type Place = PaneSelection | Page;

/** A preview's layout is one pane showing one chat. */
export type View =
  | { readonly kind: "page"; readonly page: Page }
  | { readonly kind: "panes"; readonly layout: Layout<PaneContent> }
  | { readonly kind: "preview"; readonly layout: Layout<PaneContent> };

/** A tab shows one place: a chat, a new chat, or a page. Opening a place that has a tab switches to it. */
export interface Tab {
  readonly id: string;
  readonly view: View;
}

export interface LastingTab extends Tab {
  readonly view: Exclude<View, { readonly kind: "preview" }>;
}

export interface ClosedTab {
  readonly tab: LastingTab;
  readonly index: number;
}

export interface WindowState {
  readonly tabs: readonly Tab[];
  readonly activeTabId: string;
  /** Previously active tabs, most recent first. Closing the active tab goes to the first. */
  readonly recent: readonly string[];
  readonly closed: readonly ClosedTab[];
}

/**
 * Why a place opens, which decides where its tab goes. A place that has a tab is shown there.
 * - preview: the window's one preview tab, which the next preview replaces.
 * - permanent: a lasting tab, shown.
 * - background: a lasting tab after the active one, not shown.
 * - next-to-parent: a child chat's preview, opened from its parent in the active tab, which it keeps.
 */
export type OpenIntent = "preview" | "permanent" | "background" | "next-to-parent";

export type WindowAction =
  | {
      readonly kind: "open";
      readonly place: Place;
      /** "here" is a window without a strip: its chats share one tab and each page has its own. */
      readonly target: OpenIntent | "here";
    }
  /** A tab's panes changed; a background tab's change lands too, as when its draft starts a chat. */
  | { readonly kind: "layout"; readonly tabId: string; readonly layout: Layout<PaneContent> }
  | { readonly kind: "page-section"; readonly section: string }
  | { readonly kind: "leave-page" }
  | { readonly kind: "new-tab" }
  | { readonly kind: "keep-tab"; readonly tabId: string }
  | { readonly kind: "close-tab"; readonly tabId: string }
  | { readonly kind: "close-others"; readonly tabId: string }
  | { readonly kind: "close-right"; readonly tabId: string }
  | { readonly kind: "reopen-tab" }
  | { readonly kind: "activate-tab"; readonly tabId: string }
  | { readonly kind: "activate-index"; readonly index: number }
  | { readonly kind: "cycle-tab"; readonly step: 1 | -1 }
  /** Moving a preview keeps it. */
  | { readonly kind: "reorder"; readonly tabIds: readonly string[]; readonly tabId: string }
  /** Closed tabs showing a chat in `gone`, known deleted or archived, don't reopen. */
  | { readonly kind: "forget-closed"; readonly gone: ReadonlySet<SessionId> }
  /** Open tabs drop chats just archived or deleted: a split keeps its other pane, and any other tab showing one closes. */
  | { readonly kind: "close-chats"; readonly sessionIds: ReadonlySet<SessionId> };

const BLANK: PaneSelection = { kind: "blank" };

/** What a page tab hands a pane reader: one new chat, never shown or stored. */
const PAGE_LAYOUT = createLayout(chatContent(BLANK), { newId: () => "page" });

const CLOSED_LIMIT = 25;

const RECENT_LIMIT = 50;

export function showsPage(place: Place): place is Page {
  return place.kind === "customize" || place.kind === "project";
}

export function activeTab(state: WindowState): Tab {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId) ?? state.tabs[0];

  if (tab === undefined) throw new Error("A window always holds a tab.");

  return tab;
}

export function tabPlace(tab: Tab): Place {
  return tab.view.kind === "page" ? tab.view.page : activeSelection(tab.view.layout);
}

/** The tab a window shows chats in: the active tab, or under a page the chat tab used last. */
export function findChatTab(state: WindowState): Tab | undefined {
  const id = [state.activeTabId, ...state.recent].find((candidate) =>
    state.tabs.some((tab) => tab.id === candidate && tab.view.kind !== "page"),
  );

  return state.tabs.find((tab) => tab.id === id);
}

export function tabLayout(tab: Tab): Layout<PaneContent> {
  return tab.view.kind === "page" ? PAGE_LAYOUT : tab.view.layout;
}

/** The focused pane's place first, then the other panes' in reading order. */
export function tabPlaces(tab: Tab): readonly Place[] {
  if (tab.view.kind === "page") return [tab.view.page];
  const focused = tab.view.layout.focus[0];

  return chatPanes(tab.view.layout)
    .toSorted((left, right) => Number(right.pane === focused) - Number(left.pane === focused))
    .map((pane) => pane.selection);
}

function chatLayout(place: PaneSelection, createId: () => string): Layout<PaneContent> {
  return createLayout(chatContent(place), { newId: createId });
}

function placeView(place: Place, createId: () => string): View {
  return showsPage(place)
    ? { kind: "page", page: place }
    : { kind: "panes", layout: chatLayout(place, createId) };
}

/** `createId` names the new chat's pane and tab. */
export function initialWindow(id: string, createId: () => string): WindowState {
  return {
    tabs: [{ id, view: placeView(BLANK, createId) }],
    activeTabId: id,
    recent: [],
    closed: [],
  };
}

function keep(tab: Tab): LastingTab {
  const view = tab.view;

  return { ...tab, view: view.kind === "preview" ? { kind: "panes", layout: view.layout } : view };
}

function keepTab(state: WindowState, tabId: string): WindowState {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);

  return tab?.view.kind === "preview" ? withTab(state, keep(tab)) : state;
}

function withTab(state: WindowState, tab: Tab): WindowState {
  return {
    ...state,
    tabs: state.tabs.map((candidate) => (candidate.id === tab.id ? tab : candidate)),
  };
}

function activate(state: WindowState, tabId: string): WindowState {
  if (state.activeTabId === tabId) return state;

  return {
    ...state,
    activeTabId: tabId,
    recent: [
      state.activeTabId,
      ...state.recent.filter((id) => id !== tabId && id !== state.activeTabId),
    ].slice(0, RECENT_LIMIT),
  };
}

function insertTab(state: WindowState, tab: Tab, at: number): WindowState {
  return { ...state, tabs: state.tabs.toSpliced(at, 0, tab) };
}

function afterActive(state: WindowState): number {
  return state.tabs.findIndex((tab) => tab.id === state.activeTabId) + 1;
}

/** One pane showing one tab, a chat: the shape of a preview and of a tab with nothing split. */
function showsOneChat(layout: Layout<PaneContent>): boolean {
  return layout.root.kind === "pane" && layout.root.tabs.length === 1;
}

/** A tab showing nothing but a blank pane: the next place opened from it uses it, and it isn't worth reopening. */
function showsOnlyBlank(tab: Tab): boolean {
  return (
    tab.view.kind !== "page" &&
    showsOneChat(tab.view.layout) &&
    activeSelection(tab.view.layout).kind === "blank"
  );
}

/** A session can sit in any pane of a tab; a page is one per window. */
function showing(tab: Tab, place: Place): boolean {
  if (tab.view.kind === "page") return showsPage(place) && tab.view.page.kind === place.kind;

  return place.kind === "session" && findSessionTab(tab.view.layout, place.sessionId) !== undefined;
}

/** Brings the place forward inside the tab already showing it. */
function reveal(tab: Tab, place: Place): Tab {
  if (tab.view.kind === "page") {
    if (!showsPage(place)) return tab;
    const page = place.section === undefined ? { ...place, section: tab.view.page.section } : place;

    return { ...tab, view: { kind: "page", page } };
  }

  if (place.kind !== "session") return tab;
  const shown = findSessionTab(tab.view.layout, place.sessionId);

  if (shown === undefined) return tab;
  const layout = reduceLayout(tab.view.layout, { kind: "activate", tab: shown.tab }, paneRules);

  return layout === tab.view.layout ? tab : { ...tab, view: { kind: "panes", layout } };
}

function openInChatTab(
  state: WindowState,
  place: PaneSelection,
  createId: () => string,
): WindowState {
  const tab = findChatTab(state);

  if (tab === undefined) {
    const id = createId();

    return activate(
      insertTab(state, { id, view: placeView(place, createId) }, state.tabs.length),
      id,
    );
  }

  const rules = { ...paneRules, newId: createId };

  const layout = showChat(tabLayout(tab), place).reduce(
    (current, action) => reduceLayout(current, action, rules),
    tabLayout(tab),
  );

  return activate(withTab(state, { ...tab, view: { kind: "panes", layout } }), tab.id);
}

/** A new chat goes to the tab already showing one, the active tab first, or to a new tab. */
function openBlank(state: WindowState, createId: () => string): WindowState {
  const waiting =
    state.tabs.find((tab) => tab.id === state.activeTabId && showsOnlyBlank(tab)) ??
    state.tabs.find(showsOnlyBlank);

  if (waiting !== undefined) return activate(state, waiting.id);
  const id = createId();

  return activate(
    insertTab(state, { id, view: placeView(BLANK, createId) }, state.tabs.length),
    id,
  );
}

function open(
  state: WindowState,
  place: Place,
  target: OpenIntent | "here",
  createId: () => string,
): WindowState {
  const existing = state.tabs.find((tab) => showing(tab, place));

  if (existing !== undefined) {
    if (target === "background") return state;

    return activate(withTab(state, reveal(existing, place)), existing.id);
  }

  if (target === "here")
    return showsPage(place)
      ? openTab(state, place, true, createId)
      : openInChatTab(state, place, createId);

  if (place.kind === "blank" && target !== "background") return openBlank(state, createId);

  if (target === "background") return openTab(state, place, false, createId);

  if (showsPage(place) || target === "permanent") {
    const active = activeTab(state);

    return showsOnlyBlank(active)
      ? withTab(state, { ...active, view: placeView(place, createId) })
      : openTab(state, place, true, createId);
  }

  const parentKept = target === "next-to-parent" ? keepTab(state, state.activeTabId) : state;

  return openPreview(parentKept, place, target, createId);
}

function openTab(
  state: WindowState,
  place: Place,
  shown: boolean,
  createId: () => string,
): WindowState {
  const tab: Tab = { id: createId(), view: placeView(place, createId) };
  const opened = insertTab(state, tab, afterActive(state));

  return shown ? activate(opened, tab.id) : opened;
}

function openPreview(
  state: WindowState,
  place: PaneSelection,
  target: "preview" | "next-to-parent",
  createId: () => string,
): WindowState {
  const active = activeTab(state);
  const replaced = state.tabs.find((tab) => tab.view.kind === "preview");
  const slot = showsOnlyBlank(active) ? active : target === "preview" ? replaced : undefined;

  const tab: Tab = {
    id: slot?.id ?? createId(),
    view: { kind: "preview", layout: chatLayout(place, createId) },
  };

  const placed =
    slot === undefined ? insertTab(state, tab, afterActive(state)) : withTab(state, tab);

  const kept =
    replaced === undefined || replaced === slot
      ? placed
      : removeTabs(placed, new Set([replaced.id]), state.closed, createId);

  return activate(kept, tab.id);
}

function closeTabs(
  state: WindowState,
  tabIds: ReadonlySet<string>,
  createId: () => string,
): WindowState {
  const leaving = state.tabs.flatMap((tab, index) =>
    tabIds.has(tab.id) && !showsOnlyBlank(tab) ? [{ tab: keep(tab), index }] : [],
  );

  return removeTabs(
    state,
    tabIds,
    [...leaving.toReversed(), ...state.closed].slice(0, CLOSED_LIMIT),
    createId,
  );
}

/** Previews last only while the window is open. */
export function withoutPreviews(state: WindowState, createId: () => string): WindowState {
  const previews = state.tabs.filter((tab) => tab.view.kind === "preview").map((tab) => tab.id);

  return removeTabs(state, new Set(previews), state.closed, createId);
}

function removeTabs(
  state: WindowState,
  tabIds: ReadonlySet<string>,
  closed: readonly ClosedTab[],
  createId: () => string,
): WindowState {
  if (!state.tabs.some((tab) => tabIds.has(tab.id))) return state;

  const remaining: WindowState = {
    ...state,
    tabs: state.tabs.filter((tab) => !tabIds.has(tab.id)),
    recent: state.recent.filter((id) => !tabIds.has(id)),
    closed,
  };

  if (!tabIds.has(state.activeTabId)) return remaining;

  const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  const stays = (tab: Tab): boolean => !tabIds.has(tab.id);

  const next =
    remaining.recent[0] ??
    state.tabs.slice(index + 1).find(stays)?.id ??
    state.tabs.slice(0, index).findLast(stays)?.id;

  if (next !== undefined)
    return {
      ...remaining,
      activeTabId: next,
      recent: remaining.recent.filter((id) => id !== next),
    };
  const fresh: Tab = { id: createId(), view: placeView(BLANK, createId) };

  return { ...remaining, tabs: [fresh], activeTabId: fresh.id };
}

/** A preview stays one while its pane shows the same chat; splitting it or showing another chat keeps it. */
function changeLayout(state: WindowState, tabId: string, layout: Layout<PaneContent>): WindowState {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);

  if (tab === undefined || tab.view.kind === "page") return state;

  if (
    tab.view.kind === "preview" &&
    showsOneChat(layout) &&
    sameSelection(activeSelection(layout), activeSelection(tab.view.layout))
  )
    return withTab(state, { ...tab, view: { kind: "preview", layout } });

  return withTab(state, { ...tab, view: { kind: "panes", layout } });
}

function forgetClosed(state: WindowState, gone: ReadonlySet<SessionId>): WindowState {
  const closed = state.closed.filter(({ tab }) =>
    tabPlaces(tab).every((place) => place.kind !== "session" || !gone.has(place.sessionId)),
  );

  return closed.length === state.closed.length ? state : { ...state, closed };
}

/** A gone chat's tab isn't worth reopening, so it closes without joining `closed`. */
function closeChats(
  state: WindowState,
  sessionIds: ReadonlySet<SessionId>,
  createId: () => string,
): WindowState {
  const goneChats = (layout: Layout<PaneContent>) =>
    chatPanes(layout).filter(
      (chat) => chat.selection.kind === "session" && sessionIds.has(chat.selection.sessionId),
    );

  const emptied = new Set(
    state.tabs
      .filter((tab) => {
        if (tab.view.kind === "page") return false;
        const gone = goneChats(tab.view.layout).length;

        return gone > 0 && gone === chatPanes(tab.view.layout).length;
      })
      .map((tab) => tab.id),
  );

  const collapsed = state.tabs.flatMap((tab): Tab[] => {
    if (tab.view.kind === "page" || emptied.has(tab.id)) return [];
    const gone = goneChats(tab.view.layout);

    if (gone.length === 0) return [];
    const layout = gone.reduce(
      (current, chat) => reduceLayout(current, { kind: "close", tab: chat.tab }, paneRules),
      tab.view.layout,
    );

    return [{ ...tab, view: { kind: "panes", layout } }];
  });

  return removeTabs(
    collapsed.reduce((current, tab) => withTab(current, tab), state),
    emptied,
    state.closed,
    createId,
  );
}

/** Shows panes again: the chat tab used last, or a new chat. */
function leavePage(state: WindowState, createId: () => string): WindowState {
  const tab = findChatTab(state);

  return tab === undefined ? openBlank(state, createId) : activate(state, tab.id);
}

export function reduce(
  state: WindowState,
  action: WindowAction,
  createId: () => string,
): WindowState {
  switch (action.kind) {
    case "open":
      return open(state, action.place, action.target, createId);
    case "layout":
      return changeLayout(state, action.tabId, action.layout);
    case "page-section": {
      const tab = activeTab(state);

      if (tab.view.kind !== "page" || tab.view.page.section === action.section) return state;

      return withTab(state, {
        ...tab,
        view: { kind: "page", page: { ...tab.view.page, section: action.section } },
      });
    }

    case "leave-page":
      return leavePage(state, createId);
    case "new-tab":
      return openBlank(state, createId);
    case "keep-tab":
      return keepTab(state, action.tabId);
    case "close-tab":
      return closeTabs(state, new Set([action.tabId]), createId);
    case "close-others":
      return closeTabs(
        state,
        new Set(state.tabs.filter((tab) => tab.id !== action.tabId).map((tab) => tab.id)),
        createId,
      );
    case "close-right": {
      const index = state.tabs.findIndex((tab) => tab.id === action.tabId);

      if (index === -1) return state;

      return closeTabs(state, new Set(state.tabs.slice(index + 1).map((tab) => tab.id)), createId);
    }

    case "reopen-tab": {
      const [last, ...rest] = state.closed;

      if (last === undefined) return state;

      return activate(
        {
          ...insertTab(state, last.tab, Math.min(last.index, state.tabs.length)),
          closed: rest,
        },
        last.tab.id,
      );
    }

    case "activate-tab":
      return state.tabs.some((tab) => tab.id === action.tabId)
        ? activate(state, action.tabId)
        : state;
    case "activate-index": {
      const tab = state.tabs[action.index];

      return tab === undefined ? state : activate(state, tab.id);
    }

    case "cycle-tab": {
      const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
      const tab = state.tabs[(index + action.step + state.tabs.length) % state.tabs.length];

      return tab === undefined ? state : activate(state, tab.id);
    }

    case "reorder": {
      const tabs = action.tabIds.flatMap((id) => state.tabs.filter((tab) => tab.id === id));

      return tabs.length === state.tabs.length ? keepTab({ ...state, tabs }, action.tabId) : state;
    }

    case "forget-closed":
      return forgetClosed(state, action.gone);
    case "close-chats":
      return closeChats(state, action.sessionIds, createId);

    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }
}
