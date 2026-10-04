/**
 * A window holds tabs. A tab shows either one top page (Environments,
 * Customize) or panes: one, or a split of two, each holding a chat, a new
 * chat or a review. A sidebar click moves the current tab; only a modified
 * click opens another.
 *
 * History is per tab. A pane keeps its own entries; the tab keeps the views
 * it moved between. Back walks the focused pane first, then the tab, so an
 * unsplit tab reads as one list and a top page returns to the split it left.
 *
 * A pinned tab is locked to its place: it sits compact at the front, survives
 * Close Other Tabs, and anything opened from it lands in a new tab.
 */

export type ReviewSection = "overview" | "guide" | "diff";

export type PanePlace =
  | { readonly kind: "new-chat" }
  | { readonly kind: "chat"; readonly chatId: string }
  | { readonly kind: "review"; readonly reviewId: string; readonly section: ReviewSection };

export type PagePlace = { readonly kind: "environments" } | { readonly kind: "customize" };

export type Place = PanePlace | PagePlace;

export interface Pane {
  readonly id: string;
  readonly entries: readonly PanePlace[];
  readonly index: number;
}

export type SplitDirection = "right" | "down";

export type View =
  | { readonly kind: "page"; readonly place: PagePlace }
  | {
      readonly kind: "panes";
      readonly panes: readonly Pane[];
      readonly activePaneId: string;
      readonly direction: SplitDirection;
    };

export type PanesView = Extract<View, { readonly kind: "panes" }>;

export interface Tab {
  readonly id: string;
  readonly views: readonly View[];
  readonly index: number;
  readonly pinned: boolean;
}

interface ClosedTab {
  readonly tab: Tab;
  readonly index: number;
}

export interface WindowState {
  readonly tabs: readonly Tab[];
  readonly activeTabId: string;
  readonly closed: readonly ClosedTab[];
  readonly serial: number;
}

export type OpenTarget = "here" | "background" | "foreground";

export type WindowAction =
  | { readonly kind: "open"; readonly place: Place; readonly target: OpenTarget }
  | { readonly kind: "replace"; readonly paneId: string; readonly place: PanePlace }
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
  | { readonly kind: "focus-pane"; readonly paneId: string }
  | { readonly kind: "split"; readonly direction: SplitDirection }
  | { readonly kind: "close-pane"; readonly paneId: string }
  | { readonly kind: "travel"; readonly step: 1 | -1 };

const NEW_CHAT: PanePlace = { kind: "new-chat" };

const CLOSED_LIMIT = 25;

function isPagePlace(place: Place): place is PagePlace {
  return place.kind === "environments" || place.kind === "customize";
}

export function currentPlace(pane: Pane): PanePlace {
  return pane.entries[pane.index] ?? NEW_CHAT;
}

/** Same page, ignoring the sub-view inside it. */
export function samePage(left: Place, right: Place): boolean {
  if (left.kind === "chat") return right.kind === "chat" && right.chatId === left.chatId;

  if (left.kind === "review") return right.kind === "review" && right.reviewId === left.reviewId;

  return left.kind === right.kind;
}

function samePlace(left: Place, right: Place): boolean {
  if (!samePage(left, right)) return false;

  if (left.kind === "review" && right.kind === "review") return left.section === right.section;

  return true;
}

export function currentView(tab: Tab): View {
  const view = tab.views[tab.index];

  if (view === undefined) throw new Error("A tab always shows a view.");

  return view;
}

export function focusedPane(view: PanesView): Pane {
  const pane = view.panes.find((candidate) => candidate.id === view.activePaneId) ?? view.panes[0];

  if (pane === undefined) throw new Error("A panes view always holds a pane.");

  return pane;
}

export function activeTab(state: WindowState): Tab {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId) ?? state.tabs[0];

  if (tab === undefined) throw new Error("A window always holds a tab.");

  return tab;
}

/** What the tab shows where focus is: its top page, or its focused pane's place. */
export function tabPlace(tab: Tab): Place {
  const view = currentView(tab);

  return view.kind === "page" ? view.place : currentPlace(focusedPane(view));
}

export function activePlace(state: WindowState): Place {
  return tabPlace(activeTab(state));
}

function panesView(serial: number, place: PanePlace): PanesView {
  const paneId = `p${serial}`;

  return {
    kind: "panes",
    panes: [{ id: paneId, entries: [place], index: 0 }],
    activePaneId: paneId,
    direction: "right",
  };
}

function viewFor(serial: number, place: Place): View {
  return isPagePlace(place) ? { kind: "page", place } : panesView(serial, place);
}

function makeTab(serial: number, place: Place): Tab {
  return { id: `t${serial}`, views: [viewFor(serial, place)], index: 0, pinned: false };
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

/** Navigating anywhere in a tab drops the views ahead of it, like a browser's forward list. */
function pushView(tab: Tab, view: View): Tab {
  return { ...tab, views: [...tab.views.slice(0, tab.index + 1), view], index: tab.index + 1 };
}

function withPane(view: PanesView, pane: Pane): PanesView {
  return {
    ...view,
    panes: view.panes.map((candidate) => (candidate.id === pane.id ? pane : candidate)),
  };
}

function pushPlace(pane: Pane, place: PanePlace): Pane {
  const current = currentPlace(pane);

  if (samePlace(current, place)) return pane;

  // A sub-view of the page already open replaces its entry instead of stacking one.
  if (samePage(current, place)) return { ...pane, entries: pane.entries.with(pane.index, place) };

  return {
    ...pane,
    entries: [...pane.entries.slice(0, pane.index + 1), place],
    index: pane.index + 1,
  };
}

function openHere(tab: Tab, place: Place, serial: number): Tab {
  const view = currentView(tab);

  if (isPagePlace(place)) {
    if (view.kind === "page" && samePage(view.place, place)) return tab;

    return pushView(tab, { kind: "page", place });
  }

  if (view.kind === "page") return pushView(tab, panesView(serial, place));

  // The other half of a split already showing this page takes focus instead.
  const twin = view.panes.find(
    (pane) => pane.id !== view.activePaneId && samePage(currentPlace(pane), place),
  );

  if (twin !== undefined) return withView(tab, { ...view, activePaneId: twin.id });

  const pane = focusedPane(view);
  const next = pushPlace(pane, place);

  if (next === pane) return tab;

  return withView({ ...tab, views: tab.views.slice(0, tab.index + 1) }, withPane(view, next));
}

function insertTab(state: WindowState, tab: Tab, at: number, activate: boolean): WindowState {
  return {
    ...state,
    tabs: state.tabs.toSpliced(at, 0, tab),
    activeTabId: activate ? tab.id : state.activeTabId,
    serial: state.serial + 1,
  };
}

/** An untouched new chat has nothing to bring back, so reopening skips it. */
function worthReopening(tab: Tab): boolean {
  const view = currentView(tab);

  if (tab.views.length > 1 || view.kind === "page") return true;

  return (
    view.panes.length > 1 ||
    view.panes.some((pane) => pane.entries.some((entry) => entry.kind !== "new-chat"))
  );
}

/** Pinned tabs stay at the front; everything else keeps its order. */
function pinnedFirst(tabs: readonly Tab[]): readonly Tab[] {
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)];
}

function pinnedCount(state: WindowState): number {
  return state.tabs.filter((tab) => tab.pinned).length;
}

function closeTabs(state: WindowState, tabIds: ReadonlySet<string>): WindowState {
  const leaving = state.tabs.flatMap((tab, index) => (tabIds.has(tab.id) ? [{ tab, index }] : []));

  if (leaving.length === 0) return state;

  const closed = [
    ...leaving.filter(({ tab }) => worthReopening(tab)).toReversed(),
    ...state.closed,
  ].slice(0, CLOSED_LIMIT);
  const tabs = state.tabs.filter((tab) => !tabIds.has(tab.id));

  if (!tabIds.has(state.activeTabId) && tabs.length > 0) return { ...state, tabs, closed };

  // The right-hand neighbour takes over, then the left, as in opencode. A pinned
  // tab never takes over by accident: with no unpinned tab left, a new chat opens.
  const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  const takesOver = (tab: Tab): boolean => !tabIds.has(tab.id) && !tab.pinned;
  const neighbour =
    state.tabs.slice(index + 1).find(takesOver) ?? state.tabs.slice(0, index).findLast(takesOver);

  if (neighbour !== undefined) return { ...state, tabs, closed, activeTabId: neighbour.id };

  const fresh = makeTab(state.serial, NEW_CHAT);

  return {
    ...state,
    tabs: [...tabs, fresh],
    activeTabId: fresh.id,
    closed,
    serial: state.serial + 1,
  };
}

function travelTab(tab: Tab, step: 1 | -1): Tab | undefined {
  const view = currentView(tab);

  if (view.kind === "panes") {
    const pane = focusedPane(view);
    const index = pane.index + step;

    if (index >= 0 && index < pane.entries.length)
      return withView(tab, withPane(view, { ...pane, index }));
  }

  const index = tab.index + step;

  return index >= 0 && index < tab.views.length ? { ...tab, index } : undefined;
}

export function canTravel(state: WindowState, step: 1 | -1): boolean {
  const tab = activeTab(state);

  return !tab.pinned && travelTab(tab, step) !== undefined;
}

export function reduce(state: WindowState, action: WindowAction): WindowState {
  switch (action.kind) {
    case "open": {
      const tab = activeTab(state);

      if (action.target === "here" && !tab.pinned) {
        const next = openHere(tab, action.place, state.serial);

        return next === tab ? state : { ...withTab(state, next), serial: state.serial + 1 };
      }

      // A pinned tab keeps its place, so what it opens lands just past the pinned group.
      const at = tab.pinned
        ? pinnedCount(state)
        : state.tabs.findIndex((candidate) => candidate.id === state.activeTabId) + 1;

      return insertTab(
        state,
        makeTab(state.serial, action.place),
        at,
        action.target !== "background",
      );
    }
    case "replace": {
      const tab = activeTab(state);
      const view = currentView(tab);
      const pane =
        view.kind === "panes"
          ? view.panes.find((candidate) => candidate.id === action.paneId)
          : undefined;

      if (view.kind !== "panes" || pane === undefined) return state;

      return withTab(
        state,
        withView(tab, {
          ...withPane(view, { ...pane, entries: pane.entries.with(pane.index, action.place) }),
          activePaneId: pane.id,
        }),
      );
    }
    case "new-tab":
      return insertTab(state, makeTab(state.serial, NEW_CHAT), state.tabs.length, true);
    case "close-tab":
      return closeTabs(state, new Set([action.tabId]));
    case "close-others":
      return closeTabs(
        state,
        new Set(
          state.tabs.filter((tab) => tab.id !== action.tabId && !tab.pinned).map((tab) => tab.id),
        ),
      );
    case "close-right": {
      const index = state.tabs.findIndex((tab) => tab.id === action.tabId);

      return closeTabs(
        state,
        new Set(
          state.tabs
            .slice(index + 1)
            .filter((tab) => !tab.pinned)
            .map((tab) => tab.id),
        ),
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

      const copy: Tab = { ...tab, id: `t${state.serial}`, pinned: false };

      return insertTab(state, copy, Math.max(index + 1, pinnedCount(state)), true);
    }
    case "reopen-tab": {
      const [last, ...rest] = state.closed;

      if (last === undefined) return state;

      return {
        ...state,
        tabs: state.tabs.toSpliced(Math.min(last.index, state.tabs.length), 0, last.tab),
        activeTabId: last.tab.id,
        closed: rest,
      };
    }
    case "activate-tab":
      return state.tabs.some((tab) => tab.id === action.tabId)
        ? { ...state, activeTabId: action.tabId }
        : state;
    case "activate-index": {
      // As in opencode, the ninth shortcut means the ninth tab.
      const tab = state.tabs[action.index];

      return tab === undefined ? state : { ...state, activeTabId: tab.id };
    }
    case "cycle-tab": {
      const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
      const tab = state.tabs[(index + action.step + state.tabs.length) % state.tabs.length];

      return tab === undefined ? state : { ...state, activeTabId: tab.id };
    }
    case "reorder": {
      const tabs = action.tabIds.flatMap((id) => state.tabs.filter((tab) => tab.id === id));

      return tabs.length === state.tabs.length ? { ...state, tabs: pinnedFirst(tabs) } : state;
    }
    case "focus-pane": {
      const tab = activeTab(state);
      const view = currentView(tab);

      if (view.kind !== "panes" || view.activePaneId === action.paneId) return state;

      return withTab(state, withView(tab, { ...view, activePaneId: action.paneId }));
    }
    case "split": {
      const tab = activeTab(state);
      const view = currentView(tab);

      // A new pane in a pinned tab could never show anything but a new chat.
      if (tab.pinned || view.kind !== "panes" || view.panes.length > 1) return state;

      const pane: Pane = { id: `p${state.serial}`, entries: [NEW_CHAT], index: 0 };

      return {
        ...withTab(
          state,
          withView(tab, {
            ...view,
            panes: [...view.panes, pane],
            activePaneId: pane.id,
            direction: action.direction,
          }),
        ),
        serial: state.serial + 1,
      };
    }
    case "close-pane": {
      const tab = activeTab(state);
      const view = currentView(tab);

      if (view.kind !== "panes") return state;

      const panes = view.panes.filter((pane) => pane.id !== action.paneId);
      const survivor = panes[0];

      if (view.panes.length < 2 || survivor === undefined) return state;

      return withTab(state, withView(tab, { ...view, panes, activePaneId: survivor.id }));
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

export function initialWindow(): WindowState {
  const review: Tab = {
    id: "t1",
    views: [
      {
        kind: "panes",
        panes: [
          {
            id: "p1",
            entries: [
              { kind: "chat", chatId: "c-drag" },
              { kind: "review", reviewId: "r-482", section: "guide" },
            ],
            index: 1,
          },
        ],
        activePaneId: "p1",
        direction: "right",
      },
    ],
    index: 0,
    pinned: false,
  };
  const chat = makeTab(2, { kind: "chat", chatId: "c-retry" });
  const split: Tab = {
    id: "t3",
    views: [
      {
        kind: "panes",
        panes: [
          { id: "p3", entries: [{ kind: "chat", chatId: "c-pairing" }], index: 0 },
          { id: "p4", entries: [{ kind: "chat", chatId: "c-e2e" }], index: 0 },
        ],
        activePaneId: "p3",
        direction: "right",
      },
    ],
    index: 0,
    pinned: false,
  };
  return {
    tabs: [review, chat, split],
    activeTabId: review.id,
    closed: [],
    serial: 6,
  };
}
