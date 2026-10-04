/**
 * A window holds tabs. A tab shows either one page (Customize, Environments)
 * or panes: one, or a split of two, each holding a new chat or a chat.
 *
 * History is per tab. A pane keeps its own entries; the tab keeps the views
 * it moved between. Back walks the focused pane first, then the tab, so an
 * unsplit tab reads as one list and a page returns to the split it covered.
 *
 * A pinned tab is locked to its place: it sits at the front, survives Close
 * Other Tabs, and anything opened from it lands in a new tab.
 */
import type { SessionId } from "@nyte-ai/protocol";
import {
  activePane,
  activeSelection,
  createSinglePane,
  orderedPanes,
  paneSelection,
  reducePaneLayout,
  sameSelection,
} from "../layout/pane-layout.ts";
import type { PaneId, PaneLayout, PaneLayoutAction, PaneSelection } from "../layout/pane-layout.ts";

export type Page =
  | {
      readonly kind: "customize";
      readonly section: string | undefined;
      /** The chat whose plugins it shows, if one was focused when it opened. */
      readonly sessionId: SessionId | undefined;
    }
  | { readonly kind: "environments"; readonly section: string | undefined };

export type Place = PaneSelection | Page;

export interface PaneHistory {
  readonly back: readonly PaneSelection[];
  readonly forward: readonly PaneSelection[];
}

export type PaneHistories = { readonly [Id in PaneId]: PaneHistory };

export type View =
  | { readonly kind: "page"; readonly page: Page }
  | { readonly kind: "panes"; readonly layout: PaneLayout; readonly history: PaneHistories };

type PanesView = Extract<View, { readonly kind: "panes" }>;

export interface Tab {
  readonly id: string;
  readonly views: readonly View[];
  readonly index: number;
  readonly pinned: boolean;
}

export interface ClosedTab {
  readonly tab: Tab;
  readonly index: number;
}

export interface WindowState {
  readonly tabs: readonly Tab[];
  readonly activeTabId: string;
  readonly closed: readonly ClosedTab[];
}

export type OpenTarget = "here" | "background" | "foreground";

export type WindowAction =
  | { readonly kind: "open"; readonly place: Place; readonly target: OpenTarget }
  /** A pane controller's proposal: `layout` is what `action` makes of the current panes. */
  | { readonly kind: "layout"; readonly action: PaneLayoutAction; readonly layout: PaneLayout }
  | { readonly kind: "page-section"; readonly section: string }
  /** Uncover the panes a page replaced, as a step Back can undo. */
  | { readonly kind: "leave-page" }
  | { readonly kind: "new-tab" }
  | { readonly kind: "close-tab"; readonly tabId: string }
  | { readonly kind: "close-others"; readonly tabId: string }
  | { readonly kind: "close-right"; readonly tabId: string }
  | { readonly kind: "toggle-pin"; readonly tabId: string }
  | { readonly kind: "duplicate-tab"; readonly tabId: string }
  | { readonly kind: "reopen-tab" }
  | { readonly kind: "activate-tab"; readonly tabId: string }
  | { readonly kind: "activate-index"; readonly index: number }
  | { readonly kind: "cycle-tab"; readonly step: 1 | -1 }
  | { readonly kind: "reorder"; readonly tabIds: readonly string[] }
  | { readonly kind: "travel"; readonly step: 1 | -1 };

const BLANK: PaneSelection = { kind: "blank" };

const BLANK_LAYOUT = createSinglePane();

const EMPTY_HISTORY: PaneHistory = { back: [], forward: [] };

const FRESH_HISTORIES: PaneHistories = { primary: EMPTY_HISTORY, secondary: EMPTY_HISTORY };

const CLOSED_LIMIT = 25;

const HISTORY_LIMIT = 50;

export function isPage(place: Place): place is Page {
  return place.kind === "customize" || place.kind === "environments";
}

export function samePlace(left: Place, right: Place): boolean {
  if (isPage(left) || isPage(right)) {
    return (
      isPage(left) && isPage(right) && left.kind === right.kind && left.section === right.section
    );
  }

  return sameSelection(left, right);
}

export function currentView(tab: Tab): View {
  const view = tab.views[tab.index];

  if (view === undefined) throw new Error("A tab always shows a view.");

  return view;
}

export function activeTab(state: WindowState): Tab {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId) ?? state.tabs[0];

  if (tab === undefined) throw new Error("A window always holds a tab.");

  return tab;
}

/** What the tab shows where focus is: its page, or its focused pane's place. */
export function tabPlace(tab: Tab): Place {
  const view = currentView(tab);

  return view.kind === "page" ? view.page : activeSelection(view.layout);
}

/** The panes a tab last showed; a page covering them keeps them for Back. */
export function tabLayout(tab: Tab): PaneLayout {
  for (let index = tab.index; index >= 0; index -= 1) {
    const view = tab.views[index];

    if (view?.kind === "panes") return view.layout;
  }

  return BLANK_LAYOUT;
}

/** Every place on screen in the tab, focused pane first. */
export function tabPlaces(tab: Tab): readonly Place[] {
  const view = currentView(tab);

  if (view.kind === "page") return [view.page];
  const focused = activePane(view.layout).id;

  return orderedPanes(view.layout)
    .toSorted((left, right) => Number(right.id === focused) - Number(left.id === focused))
    .map((pane) => pane.selection);
}

function panesView(layout: PaneLayout): PanesView {
  return { kind: "panes", layout, history: FRESH_HISTORIES };
}

export function newTab(id: string, place: Place): Tab {
  return {
    id,
    views: [
      isPage(place) ? { kind: "page", page: place } : panesView(createSinglePane("primary", place)),
    ],
    index: 0,
    pinned: false,
  };
}

export function initialWindow(id: string): WindowState {
  return { tabs: [newTab(id, BLANK)], activeTabId: id, closed: [] };
}

function withTab(state: WindowState, tab: Tab): WindowState {
  return {
    ...state,
    tabs: state.tabs.map((candidate) => (candidate.id === tab.id ? tab : candidate)),
  };
}

/** Replace the view on screen. Layout changes are not navigation, so nothing stacks. */
function withView(tab: Tab, view: View): Tab {
  return { ...tab, views: tab.views.with(tab.index, view) };
}

/** Navigating drops the views ahead, like a browser's forward list. */
function pushView(tab: Tab, view: View): Tab {
  return { ...tab, views: [...tab.views.slice(0, tab.index + 1), view], index: tab.index + 1 };
}

function withHistory(
  histories: PaneHistories,
  paneId: PaneId,
  history: PaneHistory,
): PaneHistories {
  return paneId === "primary"
    ? { ...histories, primary: history }
    : { ...histories, secondary: history };
}

function withSelection(layout: PaneLayout, paneId: PaneId, selection: PaneSelection): PaneLayout {
  if (layout.kind === "single") return { ...layout, selection };

  return paneId === "primary"
    ? { ...layout, primary: selection }
    : { ...layout, secondary: selection };
}

/**
 * Record a layout change in the panes' histories. Selecting something new
 * stacks the old entry; a new chat turning into the chat it started, and every
 * structural change, replace in place.
 */
function recordLayout(tab: Tab, view: PanesView, next: PaneLayout, action: PaneLayoutAction): Tab {
  const navigation = action.kind === "select" || action.kind === "select-in-pane";
  let moved = false;

  const history = (paneId: PaneId): PaneHistory => {
    const before = paneSelection(view.layout, paneId);
    const after = paneSelection(next, paneId);

    if (before === undefined || after === undefined) return EMPTY_HISTORY;

    if (sameSelection(before, after)) return view.history[paneId];
    moved = true;

    if (!navigation || (action.kind === "select-in-pane" && before.kind === "blank"))
      return view.history[paneId];

    return { back: [...view.history[paneId].back, before].slice(-HISTORY_LIMIT), forward: [] };
  };

  const nextView: PanesView = {
    kind: "panes",
    layout: next,
    history: { primary: history("primary"), secondary: history("secondary") },
  };

  return navigation && moved
    ? { ...tab, views: [...tab.views.slice(0, tab.index), nextView] }
    : withView(tab, nextView);
}

function openHere(tab: Tab, place: Place): Tab {
  const view = currentView(tab);

  if (isPage(place)) {
    if (view.kind === "page" && view.page.kind === place.kind) return tab;

    return pushView(tab, { kind: "page", page: place });
  }

  if (view.kind === "page") return pushView(tab, panesView(createSinglePane("primary", place)));
  const action: PaneLayoutAction = { kind: "select", selection: place };
  const next = reducePaneLayout(view.layout, action);

  return next === view.layout ? tab : recordLayout(tab, view, next, action);
}

function pinnedCount(state: WindowState): number {
  return state.tabs.filter((tab) => tab.pinned).length;
}

function insertTab(state: WindowState, tab: Tab, at: number, activate: boolean): WindowState {
  return {
    ...state,
    tabs: state.tabs.toSpliced(at, 0, tab),
    activeTabId: activate ? tab.id : state.activeTabId,
  };
}

/** Open a place in a new tab beside the active one, or past the pinned group. */
function openInTab(
  state: WindowState,
  place: Place,
  activate: boolean,
  createId: () => string,
): WindowState {
  const tab = activeTab(state);

  const at = tab.pinned
    ? pinnedCount(state)
    : state.tabs.findIndex((candidate) => candidate.id === tab.id) + 1;

  return insertTab(state, newTab(createId(), place), at, activate);
}

/** An untouched new chat has nothing to bring back, so reopening skips it. */
function worthReopening(tab: Tab): boolean {
  const view = currentView(tab);

  if (tab.views.length > 1 || view.kind === "page") return true;

  return (
    view.layout.kind === "split" ||
    activeSelection(view.layout).kind !== "blank" ||
    view.history.primary.back.length + view.history.primary.forward.length > 0 ||
    view.history.secondary.back.length + view.history.secondary.forward.length > 0
  );
}

/** Pinned tabs stay at the front; everything else keeps its order. */
function pinnedFirst(tabs: readonly Tab[]): readonly Tab[] {
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)];
}

function closeTabs(
  state: WindowState,
  tabIds: ReadonlySet<string>,
  createId: () => string,
): WindowState {
  const leaving = state.tabs.flatMap((tab, index) => (tabIds.has(tab.id) ? [{ tab, index }] : []));

  if (leaving.length === 0) return state;

  const closed = [
    ...leaving.filter(({ tab }) => worthReopening(tab)).toReversed(),
    ...state.closed,
  ].slice(0, CLOSED_LIMIT);

  const tabs = state.tabs.filter((tab) => !tabIds.has(tab.id));

  if (!tabIds.has(state.activeTabId) && tabs.length > 0) return { ...state, tabs, closed };

  // The right-hand neighbour takes over, then the left. A pinned tab never
  // takes over: with no unpinned tab left, a new chat opens.
  const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  const takesOver = (tab: Tab): boolean => !tabIds.has(tab.id) && !tab.pinned;

  const neighbour =
    state.tabs.slice(index + 1).find(takesOver) ?? state.tabs.slice(0, index).findLast(takesOver);

  if (neighbour !== undefined) return { ...state, tabs, closed, activeTabId: neighbour.id };
  const fresh = newTab(createId(), BLANK);

  return { tabs: [...tabs, fresh], activeTabId: fresh.id, closed };
}

function travelTab(tab: Tab, step: 1 | -1): Tab | undefined {
  const view = currentView(tab);

  if (view.kind === "panes") {
    const pane = activePane(view.layout);
    const history = view.history[pane.id];
    const target = (step < 0 ? history.back : history.forward).at(-1);

    if (target !== undefined) {
      const next: PaneHistory =
        step < 0
          ? { back: history.back.slice(0, -1), forward: [...history.forward, pane.selection] }
          : { back: [...history.back, pane.selection], forward: history.forward.slice(0, -1) };

      return withView(tab, {
        kind: "panes",
        layout: withSelection(view.layout, pane.id, target),
        history: withHistory(view.history, pane.id, next),
      });
    }
  }

  const index = tab.index + step;

  return index >= 0 && index < tab.views.length ? { ...tab, index } : undefined;
}

export function canTravel(state: WindowState, step: 1 | -1): boolean {
  const tab = activeTab(state);

  return !tab.pinned && travelTab(tab, step) !== undefined;
}

/** The place a layout change brings on screen, for a pinned tab to hand to a new one. */
function proposedPlace(action: PaneLayoutAction): PaneSelection | undefined {
  switch (action.kind) {
    case "select":
    case "select-in-pane":
      return action.selection;
    case "drop-session":
      return { kind: "session", sessionId: action.sessionId };
    default:
      return undefined;
  }
}

function reduceLayout(
  state: WindowState,
  action: PaneLayoutAction,
  layout: PaneLayout,
  createId: () => string,
): WindowState {
  const tab = activeTab(state);
  const view = currentView(tab);
  const place = proposedPlace(action);

  if (tab.pinned) {
    if (place !== undefined) return openInTab(state, place, true, createId);

    if (action.kind === "split" || action.kind === "close" || view.kind === "page") return state;

    return withTab(state, withView(tab, { ...view, layout }));
  }

  if (view.kind === "page") {
    if (place === undefined || action.kind === "drop-session") return state;

    return withTab(state, pushView(tab, panesView(createSinglePane("primary", place))));
  }

  return withTab(state, recordLayout(tab, view, layout, action));
}

export function reduce(
  state: WindowState,
  action: WindowAction,
  createId: () => string,
): WindowState {
  switch (action.kind) {
    case "open": {
      const tab = activeTab(state);

      if (action.target === "here" && !tab.pinned) {
        const next = openHere(tab, action.place);

        return next === tab ? state : withTab(state, next);
      }

      return openInTab(state, action.place, action.target !== "background", createId);
    }

    case "layout":
      return reduceLayout(state, action.action, action.layout, createId);
    case "page-section": {
      const tab = activeTab(state);
      const view = currentView(tab);

      if (view.kind !== "page" || view.page.section === action.section) return state;

      return withTab(
        state,
        withView(tab, { kind: "page", page: { ...view.page, section: action.section } }),
      );
    }

    case "leave-page": {
      const tab = activeTab(state);

      if (currentView(tab).kind !== "page") return state;

      if (tab.pinned) return openInTab(state, BLANK, true, createId);

      const covered =
        tab.views.slice(0, tab.index).findLast((view) => view.kind === "panes") ??
        panesView(BLANK_LAYOUT);

      return withTab(state, pushView(tab, covered));
    }

    case "new-tab":
      return insertTab(state, newTab(createId(), BLANK), state.tabs.length, true);
    case "close-tab":
      return closeTabs(state, new Set([action.tabId]), createId);
    case "close-others":
      return closeTabs(
        state,
        new Set(
          state.tabs.filter((tab) => tab.id !== action.tabId && !tab.pinned).map((tab) => tab.id),
        ),
        createId,
      );
    case "close-right": {
      const index = state.tabs.findIndex((tab) => tab.id === action.tabId);

      if (index === -1) return state;

      return closeTabs(
        state,
        new Set(
          state.tabs
            .slice(index + 1)
            .filter((tab) => !tab.pinned)
            .map((tab) => tab.id),
        ),
        createId,
      );
    }

    case "toggle-pin":
      return {
        ...state,
        tabs: pinnedFirst(
          state.tabs.map((tab) =>
            tab.id === action.tabId ? { ...tab, pinned: !tab.pinned } : tab,
          ),
        ),
      };
    case "duplicate-tab": {
      const index = state.tabs.findIndex((tab) => tab.id === action.tabId);
      const tab = state.tabs[index];

      if (tab === undefined) return state;

      return insertTab(
        state,
        { ...tab, id: createId(), pinned: false },
        Math.max(index + 1, pinnedCount(state)),
        true,
      );
    }

    case "reopen-tab": {
      const [last, ...rest] = state.closed;

      if (last === undefined) return state;

      return {
        ...state,
        tabs: pinnedFirst(
          state.tabs.toSpliced(Math.min(last.index, state.tabs.length), 0, last.tab),
        ),
        activeTabId: last.tab.id,
        closed: rest,
      };
    }

    case "activate-tab":
      return state.activeTabId !== action.tabId && state.tabs.some((tab) => tab.id === action.tabId)
        ? { ...state, activeTabId: action.tabId }
        : state;
    case "activate-index": {
      // The ninth shortcut means the ninth tab, not the last.
      const tab = state.tabs[action.index];

      return tab === undefined || tab.id === state.activeTabId
        ? state
        : { ...state, activeTabId: tab.id };
    }

    case "cycle-tab": {
      const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
      const tab = state.tabs[(index + action.step + state.tabs.length) % state.tabs.length];

      return tab === undefined || tab.id === state.activeTabId
        ? state
        : { ...state, activeTabId: tab.id };
    }

    case "reorder": {
      const tabs = action.tabIds.flatMap((id) => state.tabs.filter((tab) => tab.id === id));

      return tabs.length === state.tabs.length ? { ...state, tabs: pinnedFirst(tabs) } : state;
    }

    case "travel": {
      const tab = activeTab(state);
      const next = tab.pinned ? undefined : travelTab(tab, action.step);

      return next === undefined ? state : withTab(state, next);
    }

    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }
}
