import type { ProjectId, SessionId } from "@nyte-ai/sdk";
import { createLayout, reduceLayout } from "../panes/layout.ts";
import type { Layout, LayoutAction, PaneId } from "../panes/layout.ts";
import { commandFocus, focusRequest, planPane, waitsForChat } from "../panes/pane-commands.ts";
import type { PaneCommand, PaneFocus } from "../panes/pane-commands.ts";
import { paneRules } from "../panes/pane-kinds.ts";
import type { PaneContent } from "../panes/pane-kinds.ts";
import {
  activeSelection,
  chatContent,
  chatPanes,
  findSessionTab,
  paneForSession,
  sameSelection,
  showChat,
} from "../panes/pane-layout.ts";
import type { PaneSelection } from "../panes/pane-layout.ts";
import type { ChatDraft } from "../panes/session-view-state.ts";

export interface CustomizePage {
  readonly kind: "customize";
  readonly section: string | undefined;
  readonly sessionId: SessionId | undefined;
}

export type Page = CustomizePage | { readonly kind: "project"; readonly projectId: ProjectId };

export type Place = PaneSelection | Page;

type View =
  | { readonly kind: "page"; readonly page: Page }
  | { readonly kind: "panes"; readonly layout: Layout<PaneContent> }
  | { readonly kind: "preview"; readonly layout: Layout<PaneContent> };

export interface Tab {
  readonly id: string;
  readonly view: View;
}

export interface LastingTab extends Tab {
  readonly view: Exclude<View, { readonly kind: "preview" }>;
}

interface ClosedTab {
  readonly tab: LastingTab;
  readonly index: number;
}

interface HiddenPane {
  readonly sessionId: SessionId;
  readonly tabId: string;
  readonly pane: PaneId;
  readonly focused: PaneId;
}

export interface WindowState {
  readonly tabs: readonly Tab[];
  readonly activeTabId: string;
  readonly recent: readonly string[];
  readonly closed: readonly ClosedTab[];
  readonly hidden: readonly HiddenPane[];
}

export type OpenIntent = "preview" | "permanent" | "background" | "next-to-parent";

export type WindowAction =
  | {
      readonly kind: "open";
      readonly place: Place;
      readonly target: OpenIntent | "here";
    }
  | {
      readonly kind: "pane";
      readonly tabId: string;
      readonly command: PaneCommand;
      readonly focus?: PaneFocus;
    }
  | {
      readonly kind: "arrange";
      readonly tabId: string;
      readonly actions: readonly LayoutAction<PaneContent>[];
    }
  | { readonly kind: "open-beside"; readonly sessionId: SessionId }
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
  | { readonly kind: "reorder"; readonly tabIds: readonly string[]; readonly tabId: string }
  | { readonly kind: "forget-closed"; readonly gone: ReadonlySet<SessionId> }
  | { readonly kind: "hide-chat"; readonly sessionId: SessionId }
  | { readonly kind: "unhide-chat"; readonly sessionId: SessionId }
  | { readonly kind: "close-chats"; readonly sessionIds: ReadonlySet<SessionId> };

export type BlankDrafts = (tabId: string, pane: PaneId) => ChatDraft;

const BLANK: PaneSelection = { kind: "blank" };

const PAGE_LAYOUT = createLayout(chatContent(BLANK), { newId: () => "page" });

const CLOSED_LIMIT = 25;

const RECENT_LIMIT = 50;

function showsPage(place: Place): place is Page {
  return place.kind === "customize" || place.kind === "project";
}

function pageTabKey(page: Page): string {
  return page.kind === "project" ? page.projectId : page.kind;
}

export function activeTab(state: WindowState): Tab {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId) ?? state.tabs[0];

  if (tab === undefined) throw new Error("A window always holds a tab.");

  return tab;
}

export function tabPlace(tab: Tab): Place {
  return tab.view.kind === "page" ? tab.view.page : activeSelection(tab.view.layout);
}

function findChatTab(state: WindowState): Tab | undefined {
  const id = [state.activeTabId, ...state.recent].find((candidate) =>
    state.tabs.some((tab) => tab.id === candidate && tab.view.kind !== "page"),
  );

  return state.tabs.find((tab) => tab.id === id);
}

export function paneTabId(state: WindowState): string {
  return findChatTab(state)?.id ?? state.activeTabId;
}

export function tabLayout(tab: Tab): Layout<PaneContent> {
  return tab.view.kind === "page" ? PAGE_LAYOUT : tab.view.layout;
}

export function shownLayout(state: WindowState, tabId: string): Layout<PaneContent> {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);

  return tab === undefined ? PAGE_LAYOUT : tabLayout(tab);
}

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

export function initialWindow(id: string, createId: () => string): WindowState {
  return {
    tabs: [{ id, view: placeView(BLANK, createId) }],
    activeTabId: id,
    recent: [],
    closed: [],
    hidden: [],
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

function showsOneChat(layout: Layout<PaneContent>): boolean {
  return layout.root.kind === "pane";
}

function showsOnlyBlank(tab: Tab): boolean {
  return (
    tab.view.kind !== "page" &&
    showsOneChat(tab.view.layout) &&
    activeSelection(tab.view.layout).kind === "blank"
  );
}

function showing(tab: Tab, place: Place): boolean {
  if (tab.view.kind === "page") {
    return showsPage(place) && pageTabKey(tab.view.page) === pageTabKey(place);
  }

  return place.kind === "session" && findSessionTab(tab.view.layout, place.sessionId) !== undefined;
}

function reveal(tab: Tab, place: Place): Tab {
  if (tab.view.kind === "page") {
    const shown = tab.view.page;

    if (place.kind !== "customize" || shown.kind !== "customize") return tab;
    const page = place.section === undefined ? { ...place, section: shown.section } : place;

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

  if (target === "here") {
    return showsPage(place)
      ? openTab(state, place, true, createId)
      : openInChatTab(state, place, createId);
  }

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

  if (next !== undefined) {
    return {
      ...remaining,
      activeTabId: next,
      recent: remaining.recent.filter((id) => id !== next),
    };
  }
  const fresh: Tab = { id: createId(), view: placeView(BLANK, createId) };

  return { ...remaining, tabs: [fresh], activeTabId: fresh.id };
}

function changeLayout(
  state: WindowState,
  tabId: string,
  layout: Layout<PaneContent>,
  createId: () => string,
  blank: BlankDrafts,
): WindowState {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);

  if (tab === undefined || tab.view.kind === "page") return state;

  const view: View =
    tab.view.kind === "preview" &&
    showsOneChat(layout) &&
    sameSelection(activeSelection(layout), activeSelection(tab.view.layout))
      ? { kind: "preview", layout }
      : { kind: "panes", layout };

  const before = new Set(shownChats(tab.view.layout));
  const arrived = new Set(shownChats(layout).filter((id) => !before.has(id)));

  return closeChats(withTab(state, { ...tab, view }), arrived, createId, blank, tab.id);
}

function arrangeTab(
  state: WindowState,
  tabId: string,
  actions: (layout: Layout<PaneContent>) => readonly LayoutAction<PaneContent>[],
  createId: () => string,
  blank: BlankDrafts,
): WindowState {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);

  if (tab === undefined) return state;
  const rules = { ...paneRules, newId: createId };

  const layout = actions(tabLayout(tab)).reduce(
    (current, action) => reduceLayout(current, action, rules),
    tabLayout(tab),
  );

  return layout === tabLayout(tab) ? state : changeLayout(state, tabId, layout, createId, blank);
}

type PaneAction = Extract<WindowAction, { readonly kind: "pane" }>;

function openBeside(state: WindowState, sessionId: SessionId): PaneAction {
  const tabId = paneTabId(state);
  const pane = shownLayout(state, tabId).focus[0];

  return { kind: "pane", tabId, command: { kind: "drop", sessionId, pane, placement: "right" } };
}

function shownChats(layout: Layout<PaneContent>): readonly SessionId[] {
  return chatPanes(layout).flatMap((pane) =>
    pane.selection.kind === "session" ? [pane.selection.sessionId] : [],
  );
}

function forgetClosed(state: WindowState, gone: ReadonlySet<SessionId>): WindowState {
  const closed = state.closed.filter(({ tab }) =>
    tabPlaces(tab).every((place) => place.kind !== "session" || !gone.has(place.sessionId)),
  );

  return closed.length === state.closed.length ? state : { ...state, closed };
}

function closeChats(
  state: WindowState,
  sessionIds: ReadonlySet<SessionId>,
  createId: () => string,
  blank: BlankDrafts,
  kept?: string,
): WindowState {
  const closing = state.tabs.filter((tab) => tab.id !== kept);

  const goneChats = (tabId: string, layout: Layout<PaneContent>) =>
    chatPanes(layout).filter(
      (chat) =>
        (chat.selection.kind === "session" && sessionIds.has(chat.selection.sessionId)) ||
        state.hidden.some(
          (entry) =>
            entry.tabId === tabId &&
            entry.pane === chat.pane &&
            sessionIds.has(entry.sessionId) &&
            waitsForChat(chat, blank(tabId, chat.pane)),
        ),
    );

  const emptied = new Set(
    closing
      .filter((tab) => {
        if (tab.view.kind === "page") return false;
        const gone = goneChats(tab.id, tab.view.layout).length;

        return gone > 0 && gone === chatPanes(tab.view.layout).length;
      })
      .map((tab) => tab.id),
  );

  const collapsed = closing.flatMap((tab): Tab[] => {
    if (tab.view.kind === "page" || emptied.has(tab.id)) return [];
    const gone = goneChats(tab.id, tab.view.layout);

    if (gone.length === 0) return [];

    const layout = gone.reduce(
      (current, chat) => reduceLayout(current, { kind: "close", tab: chat.tab }, paneRules),
      tab.view.layout,
    );

    return [{ ...tab, view: { kind: "panes", layout } }];
  });

  const remaining = removeTabs(
    collapsed.reduce((current, tab) => withTab(current, tab), state),
    emptied,
    state.closed,
    createId,
  );

  const unhidden = remaining.hidden.filter((entry) => !sessionIds.has(entry.sessionId));

  return unhidden.length === remaining.hidden.length
    ? remaining
    : { ...remaining, hidden: unhidden };
}

export function withChatsInOneTab(state: WindowState, createId: () => string): WindowState {
  const order = new Set([state.activeTabId, ...state.recent, ...state.tabs.map((tab) => tab.id)]);

  return [...order].reduce((current, tabId) => {
    const tab = current.tabs.find((candidate) => candidate.id === tabId);

    return tab === undefined
      ? current
      : closeChats(current, new Set(shownChats(tabLayout(tab))), createId, readsNoBlank, tabId);
  }, state);
}

function readsNoBlank(): never {
  throw new Error("A saved window hides no pane.");
}

function hideChat(
  state: WindowState,
  sessionId: SessionId,
  createId: () => string,
  blank: BlankDrafts,
): WindowState {
  const hiding = state.tabs.flatMap((tab): HiddenPane[] => {
    const layout = tabLayout(tab);
    const pane = paneForSession(layout, sessionId);

    return tab.view.kind === "page" || pane === undefined
      ? []
      : [{ sessionId, tabId: tab.id, pane, focused: layout.focus[0] }];
  });

  if (hiding.length === 0) return state;

  const hidden = hiding.reduce(
    (current, entry) =>
      reduce(
        current,
        { kind: "pane", tabId: entry.tabId, command: { kind: "hide", sessionId } },
        createId,
        blank,
      ),
    state,
  );

  return { ...hidden, hidden: [...hidden.hidden, ...hiding] };
}

function unhideChat(
  state: WindowState,
  sessionId: SessionId,
  createId: () => string,
  blank: BlankDrafts,
): WindowState {
  const hiding = state.hidden.filter((entry) => entry.sessionId === sessionId);

  if (hiding.length === 0) return state;
  const place: Place = { kind: "session", sessionId };

  return hiding.toReversed().reduce<WindowState>(
    (current, entry) =>
      current.tabs.some((tab) => showing(tab, place))
        ? current
        : reduce(
            current,
            {
              kind: "pane",
              tabId: entry.tabId,
              command: { kind: "unhide", sessionId, pane: entry.pane, focused: entry.focused },
            },
            createId,
            blank,
          ),
    { ...state, hidden: state.hidden.filter((entry) => entry.sessionId !== sessionId) },
  );
}

function reopenTab(state: WindowState, createId: () => string): WindowState {
  const last = state.closed[0];

  if (last === undefined) return state;
  const rest: WindowState = { ...state, closed: state.closed.slice(1) };

  if (last.tab.view.kind === "page") {
    const page = last.tab.view.page;

    return rest.tabs.some((tab) => showing(tab, page))
      ? open(rest, page, "permanent", createId)
      : restoreTab(rest, last.tab, last.index);
  }

  const layout = last.tab.view.layout;

  const taken = chatPanes(layout).filter((pane) =>
    rest.tabs.some((tab) => showing(tab, pane.selection)),
  );

  if (taken.length === 0) return restoreTab(rest, last.tab, last.index);
  const focused = tabPlaces(last.tab).find((place) => place.kind === "session");

  if (taken.length === shownChats(layout).length && focused !== undefined) {
    return open(rest, focused, "permanent", createId);
  }

  const left = taken.reduce(
    (current, pane) => reduceLayout(current, { kind: "close", tab: pane.tab }, paneRules),
    layout,
  );

  return restoreTab(rest, { ...last.tab, view: { kind: "panes", layout: left } }, last.index);
}

function restoreTab(state: WindowState, tab: Tab, index: number): WindowState {
  return activate(insertTab(state, tab, Math.min(index, state.tabs.length)), tab.id);
}

function leavePage(state: WindowState, createId: () => string): WindowState {
  const tab = findChatTab(state);

  return tab === undefined ? openBlank(state, createId) : activate(state, tab.id);
}

export function reduce(
  state: WindowState,
  action: WindowAction,
  createId: () => string,
  blank: BlankDrafts,
): WindowState {
  return withLiveHidden(step(state, action, createId, blank));
}

function withLiveHidden(state: WindowState): WindowState {
  const hidden = state.hidden.filter((entry) =>
    state.tabs.some(
      (tab) =>
        tab.id === entry.tabId &&
        chatPanes(tabLayout(tab)).some(
          (chat) => chat.pane === entry.pane && chat.selection.kind === "blank",
        ),
    ),
  );

  return hidden.length === state.hidden.length ? state : { ...state, hidden };
}

function step(
  state: WindowState,
  action: WindowAction,
  createId: () => string,
  blank: BlankDrafts,
): WindowState {
  switch (action.kind) {
    case "open":
      return open(state, action.place, action.target, createId);
    case "pane":
      return arrangeTab(
        state,
        action.tabId,
        (layout) => planPane(layout, action.command, (pane) => blank(action.tabId, pane)).actions,
        createId,
        blank,
      );
    case "arrange":
      return arrangeTab(state, action.tabId, () => action.actions, createId, blank);
    case "open-beside":
      return reduce(state, openBeside(state, action.sessionId), createId, blank);
    case "page-section": {
      const tab = activeTab(state);

      if (tab.view.kind !== "page" || tab.view.page.kind !== "customize") return state;

      if (tab.view.page.section === action.section) return state;

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

    case "reopen-tab":
      return reopenTab(state, createId);

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
    case "hide-chat":
      return hideChat(state, action.sessionId, createId, blank);
    case "unhide-chat":
      return unhideChat(state, action.sessionId, createId, blank);
    case "close-chats":
      return closeChats(state, action.sessionIds, createId, blank);

    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }
}

export function focusRequests(
  before: WindowState,
  after: WindowState,
  action: WindowAction,
): ReadonlyMap<string, PaneId> {
  if (action.kind === "hide-chat") return new Map();
  const acting = actingTab(before, action);

  const changed = after.tabs.flatMap((tab): [string, PaneId][] => {
    const previous = before.tabs.find((candidate) => candidate.id === tab.id);

    return previous === undefined || tab.id === acting || tabLayout(previous) === tabLayout(tab)
      ? []
      : [[tab.id, tabLayout(tab).focus[0]]];
  });

  const own = ownRequest(before, after, action);

  return new Map(own === undefined ? changed : [...changed, own]);
}

function actingTab(state: WindowState, action: WindowAction): string | undefined {
  if (action.kind === "arrange") return action.tabId;

  return commandIn(state, action)?.tabId;
}

function commandIn(state: WindowState, action: WindowAction): PaneAction | undefined {
  if (action.kind === "pane") return action;

  return action.kind === "open-beside" ? openBeside(state, action.sessionId) : undefined;
}

function ownRequest(
  before: WindowState,
  after: WindowState,
  action: WindowAction,
): [string, PaneId] | undefined {
  const pane = commandIn(before, action);

  if (pane === undefined) return undefined;
  const previous = before.tabs.find((tab) => tab.id === pane.tabId);
  const next = after.tabs.find((tab) => tab.id === pane.tabId);

  if (previous === undefined || next === undefined) return undefined;

  const requested = focusRequest(
    tabLayout(previous),
    tabLayout(next),
    pane.focus ?? commandFocus(pane.command),
  );

  return requested === undefined ? undefined : [pane.tabId, requested];
}
