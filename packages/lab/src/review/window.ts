/**
 * The window the review demo runs in, as `docs/tabs.md` describes it: tabs,
 * each with its own history. A plain open lands in the active tab; a modified
 * one opens a background tab. Back and forward walk the active tab. Switching
 * a pull request's view replaces its entry instead of adding one.
 *
 * Pure: the shell keeps it in a reducer, so nothing here needs an effect.
 */
import type { MouseEvent } from "react";

export type ReviewView = "overview" | "guide" | "diff";

export type Place =
  | { readonly kind: "new-chat" }
  /** The pull requests waiting on you: the sidebar's Review page. */
  | { readonly kind: "reviews" }
  /** A pull request's page, on one of its views. */
  | { readonly kind: "review"; readonly reviewId: string; readonly view?: ReviewView };

export interface Tab {
  readonly id: string;
  readonly entries: readonly Place[];
  readonly index: number;
}

export interface WindowState {
  readonly tabs: readonly Tab[];
  readonly active: string;
  readonly serial: number;
}

export type OpenTarget = "here" | "background" | "foreground";

export type WindowAction =
  | { readonly kind: "open"; readonly place: Place; readonly target: OpenTarget }
  /** Swap what the active tab shows without a step for Back. */
  | { readonly kind: "replace"; readonly place: Place }
  | { readonly kind: "new-tab" }
  | { readonly kind: "activate"; readonly tabId: string }
  | { readonly kind: "close-tab"; readonly tabId: string }
  | { readonly kind: "back" }
  | { readonly kind: "forward" };

/** The pull request a place is about, if it is about one. */
export function reviewOf(place: Place): string | undefined {
  return place.kind === "review" ? place.reviewId : undefined;
}

/** How a click asks to open a place: ⌘ or a middle click for a background tab. */
export function targetOf(event: MouseEvent): OpenTarget {
  return event.metaKey || event.ctrlKey || event.button === 1 ? "background" : "here";
}

export function samePlace(left: Place, right: Place): boolean {
  return left.kind === right.kind && reviewOf(left) === reviewOf(right);
}

export const placeOf = (tab: Tab): Place => tab.entries[tab.index] ?? { kind: "new-chat" };

export function activeTab(state: WindowState): Tab | undefined {
  return state.tabs.find((tab) => tab.id === state.active);
}

/** What the active tab shows. */
export function focusedPlace(state: WindowState): Place | undefined {
  const tab = activeTab(state);

  return tab === undefined ? undefined : placeOf(tab);
}

/** The pull request the active tab shows, if it shows one. */
export function focusedReview(state: WindowState): string | undefined {
  const place = focusedPlace(state);

  return place === undefined ? undefined : reviewOf(place);
}

const newTab = (serial: number, place: Place): Tab => ({
  id: `tab-${serial}`,
  entries: [place],
  index: 0,
});

/** The window opens on the Review page, or on one pull request when the address names it. */
export function initialWindow(reviewId: string | undefined): WindowState {
  const place: Place = reviewId === undefined ? { kind: "reviews" } : { kind: "review", reviewId };

  return { tabs: [newTab(1, place)], active: "tab-1", serial: 2 };
}

function updateActive(state: WindowState, change: (tab: Tab) => Tab): WindowState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === state.active ? change(tab) : tab)),
  };
}

function insertAfterActive(state: WindowState, tab: Tab): readonly Tab[] {
  const at = state.tabs.findIndex((entry) => entry.id === state.active);

  return [...state.tabs.slice(0, at + 1), tab, ...state.tabs.slice(at + 1)];
}

export function reduce(state: WindowState, action: WindowAction): WindowState {
  switch (action.kind) {
    case "open": {
      if (action.target !== "here") {
        const tab = newTab(state.serial, action.place);

        return {
          tabs: insertAfterActive(state, tab),
          active: action.target === "foreground" ? tab.id : state.active,
          serial: state.serial + 1,
        };
      }

      // Push, dropping anything forward of where the tab stands.
      return updateActive(state, (tab) =>
        samePlace(placeOf(tab), action.place)
          ? tab
          : {
              ...tab,
              entries: [...tab.entries.slice(0, tab.index + 1), action.place],
              index: tab.index + 1,
            },
      );
    }

    case "replace":
      return updateActive(state, (tab) => ({
        ...tab,
        entries: tab.entries.map((entry, index) => (index === tab.index ? action.place : entry)),
      }));
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

    case "back":
      return updateActive(state, (tab) => ({ ...tab, index: Math.max(0, tab.index - 1) }));
    case "forward":
      return updateActive(state, (tab) => ({
        ...tab,
        index: Math.min(tab.entries.length - 1, tab.index + 1),
      }));
    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }
}

export function canGo(state: WindowState, direction: "back" | "forward"): boolean {
  const tab = activeTab(state);

  if (tab === undefined) return false;

  return direction === "back" ? tab.index > 0 : tab.index < tab.entries.length - 1;
}
