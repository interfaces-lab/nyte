/**
 * The window the review demo runs in, as `docs/tabs.md` describes it: tabs,
 * each holding one pane or a split of two, each pane with its own history.
 * A plain open lands in the focused pane; a modified one opens a background
 * tab; "beside" splits the tab. Back and forward walk the focused pane.
 *
 * Pure: the shell keeps it in a reducer, so nothing here needs an effect.
 */

export type Place =
  | { readonly kind: "new-chat" }
  /** The pull requests waiting on you: the sidebar's Review page. */
  | { readonly kind: "reviews" }
  /** A pull request's conversation with Nyte and the reviewer. */
  | { readonly kind: "chat"; readonly reviewId: string }
  /** The pull request's page, on one of its views; switching views replaces the entry. */
  | { readonly kind: "review"; readonly reviewId: string; readonly view?: ReviewView };

export type ReviewView = "overview" | "guide" | "diff";

export interface Pane {
  readonly id: string;
  readonly entries: readonly Place[];
  readonly index: number;
}

export interface Tab {
  readonly id: string;
  readonly panes: readonly Pane[];
  readonly focus: string;
}

export interface WindowState {
  readonly tabs: readonly Tab[];
  readonly active: string;
  readonly serial: number;
}

export type OpenTarget = "here" | "background" | "foreground" | "beside";

export type WindowAction =
  | { readonly kind: "open"; readonly place: Place; readonly target: OpenTarget }
  /** Swap what a pane shows without a step for Back: the focused pane, or `paneId`. */
  | { readonly kind: "replace"; readonly place: Place; readonly paneId?: string }
  | { readonly kind: "new-tab" }
  | { readonly kind: "activate"; readonly tabId: string }
  | { readonly kind: "close-tab"; readonly tabId: string }
  | { readonly kind: "focus-pane"; readonly paneId: string }
  | { readonly kind: "close-pane"; readonly paneId: string }
  | { readonly kind: "back" }
  | { readonly kind: "forward" };

/** The pull request a place is about, if it is about one. */
export function reviewOf(place: Place): string | undefined {
  return place.kind === "chat" || place.kind === "review" ? place.reviewId : undefined;
}

export function samePlace(left: Place, right: Place): boolean {
  return left.kind === right.kind && reviewOf(left) === reviewOf(right);
}

export const placeOf = (pane: Pane): Place => pane.entries[pane.index] ?? { kind: "new-chat" };

export function activeTab(state: WindowState): Tab | undefined {
  return state.tabs.find((tab) => tab.id === state.active);
}

export function focusedPane(tab: Tab): Pane | undefined {
  return tab.panes.find((pane) => pane.id === tab.focus) ?? tab.panes[0];
}

/** What the focused pane of the active tab shows. */
export function focusedPlace(state: WindowState): Place | undefined {
  const tab = activeTab(state);
  const pane = tab === undefined ? undefined : focusedPane(tab);

  return pane === undefined ? undefined : placeOf(pane);
}

/** The review the active tab is about, from its focused pane first. */
export function focusedReview(state: WindowState): string | undefined {
  const tab = activeTab(state);

  if (tab === undefined) return undefined;

  const ordered = [focusedPane(tab), ...tab.panes].flatMap((pane) =>
    pane === undefined ? [] : [placeOf(pane)],
  );

  return ordered.flatMap((place) => {
    const reviewId = reviewOf(place);

    return reviewId === undefined ? [] : [reviewId];
  })[0];
}

function newTab(serial: number, place: Place): Tab {
  const pane: Pane = { id: `pane-${serial}`, entries: [place], index: 0 };

  return { id: `tab-${serial}`, panes: [pane], focus: pane.id };
}

/** The window opens on the Review page, or on one pull request when the address names it. */
export function initialWindow(reviewId: string | undefined): WindowState {
  const place: Place = reviewId === undefined ? { kind: "reviews" } : { kind: "review", reviewId };

  return { tabs: [newTab(1, place)], active: "tab-1", serial: 2 };
}

function updateTab(state: WindowState, change: (tab: Tab) => Tab): WindowState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === state.active ? change(tab) : tab)),
  };
}

function updatePane(tab: Tab, change: (pane: Pane) => Pane, paneId?: string): Tab {
  const target = tab.panes.find((pane) => pane.id === paneId) ?? focusedPane(tab);

  return {
    ...tab,
    panes: tab.panes.map((pane) => (pane.id === target?.id ? change(pane) : pane)),
  };
}

/** Push `place` onto a pane's history, dropping anything forward of where it stands. */
function push(pane: Pane, place: Place): Pane {
  if (samePlace(placeOf(pane), place)) return pane;

  return {
    ...pane,
    entries: [...pane.entries.slice(0, pane.index + 1), place],
    index: pane.index + 1,
  };
}

function insertAfterActive(state: WindowState, tab: Tab): readonly Tab[] {
  const at = state.tabs.findIndex((entry) => entry.id === state.active);

  return [...state.tabs.slice(0, at + 1), tab, ...state.tabs.slice(at + 1)];
}

export function reduce(state: WindowState, action: WindowAction): WindowState {
  switch (action.kind) {
    case "open": {
      if (action.target === "background" || action.target === "foreground") {
        const tab = newTab(state.serial, action.place);

        return {
          tabs: insertAfterActive(state, tab),
          active: action.target === "foreground" ? tab.id : state.active,
          serial: state.serial + 1,
        };
      }

      if (action.target === "beside")
        return updateTab({ ...state, serial: state.serial + 1 }, (tab) => {
          const other = tab.panes.find((pane) => pane.id !== tab.focus);

          // The other half already shows it: focus it instead of opening a third.
          if (other !== undefined && samePlace(placeOf(other), action.place))
            return { ...tab, focus: other.id };

          if (other !== undefined)
            return {
              ...tab,
              panes: tab.panes.map((pane) =>
                pane.id === other.id ? push(pane, action.place) : pane,
              ),
              focus: other.id,
            };

          const pane: Pane = { id: `pane-${state.serial}`, entries: [action.place], index: 0 };

          return { ...tab, panes: [...tab.panes, pane], focus: pane.id };
        });

      return updateTab(state, (tab) => updatePane(tab, (pane) => push(pane, action.place)));
    }

    case "replace":
      return updateTab(state, (tab) =>
        updatePane(
          tab,
          (pane) => ({
            ...pane,
            entries: pane.entries.map((entry, index) =>
              index === pane.index ? action.place : entry,
            ),
          }),
          action.paneId,
        ),
      );
    case "new-tab": {
      const tab = newTab(state.serial, { kind: "new-chat" });

      return { tabs: insertAfterActive(state, tab), active: tab.id, serial: state.serial + 1 };
    }

    case "activate":
      return state.tabs.some((tab) => tab.id === action.tabId)
        ? { ...state, active: action.tabId }
        : state;
    case "close-tab": {
      const at = state.tabs.findIndex((tab) => tab.id === action.tabId);
      const rest = state.tabs.filter((tab) => tab.id !== action.tabId);

      // No overview behind the strip: closing the last tab leaves a new chat.
      if (rest.length === 0) {
        const tab = newTab(state.serial, { kind: "new-chat" });

        return { tabs: [tab], active: tab.id, serial: state.serial + 1 };
      }

      if (action.tabId !== state.active) return { ...state, tabs: rest };

      // The tab to the right takes over, then the one to the left.
      const next = rest[Math.min(at, rest.length - 1)];

      return { ...state, tabs: rest, active: next?.id ?? state.active };
    }

    case "focus-pane":
      return updateTab(state, (tab) =>
        tab.panes.some((pane) => pane.id === action.paneId)
          ? { ...tab, focus: action.paneId }
          : tab,
      );
    case "close-pane":
      return updateTab(state, (tab) => {
        const panes = tab.panes.filter((pane) => pane.id !== action.paneId);
        const first = panes[0];

        return first === undefined ? tab : { ...tab, panes, focus: first.id };
      });
    case "back":
      return updateTab(state, (tab) =>
        updatePane(tab, (pane) => ({ ...pane, index: Math.max(0, pane.index - 1) })),
      );
    case "forward":
      return updateTab(state, (tab) =>
        updatePane(tab, (pane) => ({
          ...pane,
          index: Math.min(pane.entries.length - 1, pane.index + 1),
        })),
      );
    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }
}

export function canGo(state: WindowState, direction: "back" | "forward"): boolean {
  const tab = activeTab(state);
  const pane = tab === undefined ? undefined : focusedPane(tab);

  if (pane === undefined) return false;

  return direction === "back" ? pane.index > 0 : pane.index < pane.entries.length - 1;
}
