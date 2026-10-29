import {
  changesScopeValue,
  MAXIMIZED_CHAT_LAYOUT,
  MAXIMIZED_WORKBENCH_LAYOUT,
  matchingTab,
  revealWorkbench,
  SPLIT_LAYOUT,
  tabSlot,
  workbenchShowsChat,
} from "./model.ts";
import type {
  KindTab,
  WorkbenchChangesScope,
  WorkbenchTab,
  WorkbenchTabId,
  WorkbenchViewState,
} from "./model.ts";
import { shareWidth } from "./width.ts";

type ChangesTab = KindTab<"changes">;

type CanvasTab = KindTab<"canvas">;

type WorkbenchTabPatch =
  | {
      readonly kind: "changes";
      readonly patch: Partial<
        Pick<ChangesTab, "scope" | "selectedPath" | "pathRevealRevision" | "scrollTop">
      >;
    }
  | { readonly kind: "file"; readonly patch: { readonly preview: boolean } }
  | { readonly kind: "browser"; readonly patch: { readonly url: string } }
  | { readonly kind: "canvas"; readonly patch: Partial<Pick<CanvasTab, "title" | "pinned">> };

export type ChangesTabPatch = Extract<WorkbenchTabPatch, { readonly kind: "changes" }>["patch"];

export type WorkbenchViewAction =
  /** Focuses the open tab `tab` names, or adds `tab`. */
  | { readonly kind: "open"; readonly tab: WorkbenchTab; readonly activate: boolean }
  /** Adds `tab` even when an open tab has its identity. */
  | { readonly kind: "add"; readonly tab: WorkbenchTab }
  /**
   * Focuses the file's tab, pinning it unless this open is a preview, or adds it in place of
   * `replace`, the clean preview the file store chose.
   */
  | {
      readonly kind: "open-file";
      readonly tab: KindTab<"file">;
      readonly replace: WorkbenchTabId | undefined;
    }
  /** Shows Changes at `scope`, revealing `path`, in the open Changes tab or a new one with `id`. */
  | {
      readonly kind: "open-changes";
      readonly id: WorkbenchTabId;
      readonly scope: WorkbenchChangesScope;
      readonly path: string | null;
    }
  | { readonly kind: "activate"; readonly id: WorkbenchTabId }
  | { readonly kind: "close"; readonly id: WorkbenchTabId }
  | { readonly kind: "move"; readonly id: WorkbenchTabId; readonly index: number }
  | { readonly kind: "patch"; readonly id: WorkbenchTabId; readonly change: WorkbenchTabPatch }
  | { readonly kind: "toggle" }
  | { readonly kind: "toggle-collapsed" }
  | { readonly kind: "toggle-maximized" }
  | { readonly kind: "show-chat" }
  | { readonly kind: "set-share"; readonly share: number }
  | { readonly kind: "toggle-sidebar"; readonly slot: string };

export function reduceView(
  state: WorkbenchViewState,
  action: WorkbenchViewAction,
): WorkbenchViewState {
  switch (action.kind) {
    case "open": {
      const existing = matchingTab(state.tabs, action.tab);

      if (existing === undefined) return addTab(state, action.tab, action.activate);

      return action.activate ? activate(state, existing.id) : state;
    }

    case "add":
      return addTab(state, action.tab, true);
    case "open-file": {
      const existing = matchingTab(state.tabs, action.tab);

      if (existing === undefined) {
        return addTab(
          { ...state, tabs: state.tabs.filter((tab) => tab.id !== action.replace) },
          action.tab,
          true,
        );
      }

      const pinned = action.tab.preview
        ? state
        : patch(state, existing.id, { kind: "file", patch: { preview: false } });

      return activate(pinned, existing.id);
    }

    case "open-changes": {
      const existing = state.tabs.find((tab) => tab.kind === "changes");
      const reveal = action.path === null ? 0 : 1;

      if (existing === undefined) {
        return addTab(
          state,
          {
            id: action.id,
            kind: "changes",
            scope: action.scope,
            selectedPath: action.path,
            pathRevealRevision: reveal,
            scrollTop: 0,
          },
          true,
        );
      }

      return activate(
        patch(state, existing.id, {
          kind: "changes",
          patch: {
            scope: action.scope,
            selectedPath: action.path,
            pathRevealRevision: existing.pathRevealRevision + reveal,
            scrollTop: 0,
          },
        }),
        existing.id,
      );
    }

    case "activate":
      return state.tabs.some((tab) => tab.id === action.id) ? activate(state, action.id) : state;
    case "close":
      return close(state, action.id);
    case "move": {
      const from = state.tabs.findIndex((tab) => tab.id === action.id);
      const target = Math.max(0, Math.min(state.tabs.length - 1, Math.round(action.index)));
      const moved = state.tabs[from];

      if (moved === undefined || from === target) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);

      return { ...state, tabs: [...tabs.slice(0, target), moved, ...tabs.slice(target)] };
    }

    case "patch":
      return patch(state, action.id, action.change);
    case "toggle":
      return {
        ...state,
        expanded: !state.expanded,
        layout: state.expanded ? state.layout : revealWorkbench(state.layout),
      };
    case "toggle-collapsed":
      return { ...state, collapsed: state.collapsed === "floating" ? "compact" : "floating" };
    case "toggle-maximized":
      return {
        ...state,
        layout: state.layout.kind === "maximized" ? SPLIT_LAYOUT : MAXIMIZED_WORKBENCH_LAYOUT,
      };
    case "show-chat":
      return state.layout.kind === "maximized" && !workbenchShowsChat(state.layout)
        ? { ...state, layout: MAXIMIZED_CHAT_LAYOUT }
        : state;
    case "set-share": {
      const width = shareWidth(action.share);

      return state.width.kind === "share" && state.width.share === width.share
        ? state
        : { ...state, width };
    }

    case "toggle-sidebar":
      return {
        ...state,
        sidebars: state.sidebars.includes(action.slot)
          ? state.sidebars.filter((slot) => slot !== action.slot)
          : [...state.sidebars, action.slot],
      };
    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }
}

function addTab(
  state: WorkbenchViewState,
  tab: WorkbenchTab,
  activateTab: boolean,
): WorkbenchViewState {
  const tabs = [...state.tabs, tab];

  return activateTab ? activate({ ...state, tabs }, tab.id) : { ...state, tabs };
}

function activate(state: WorkbenchViewState, id: WorkbenchTabId): WorkbenchViewState {
  const layout = revealWorkbench(state.layout);

  return state.active === id && state.expanded && layout === state.layout
    ? state
    : { ...state, active: id, expanded: true, layout };
}

function close(state: WorkbenchViewState, id: WorkbenchTabId): WorkbenchViewState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  const closed = state.tabs[index];

  if (closed === undefined) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);

  const active =
    state.active === id ? (tabs[index]?.id ?? tabs[index - 1]?.id ?? null) : state.active;

  const slot = tabSlot(closed);

  return {
    ...state,
    tabs,
    active,
    expanded: state.expanded && active !== null,
    sidebars: tabs.some((tab) => tabSlot(tab) === slot)
      ? state.sidebars
      : state.sidebars.filter((open) => open !== slot),
  };
}

function patch(
  state: WorkbenchViewState,
  id: WorkbenchTabId,
  change: WorkbenchTabPatch,
): WorkbenchViewState {
  const tab = state.tabs.find((candidate) => candidate.id === id);

  if (tab === undefined) return state;
  const next = patchTab(tab, change);

  return next === tab
    ? state
    : { ...state, tabs: state.tabs.map((candidate) => (candidate === tab ? next : candidate)) };
}

function patchTab(tab: WorkbenchTab, change: WorkbenchTabPatch): WorkbenchTab {
  switch (change.kind) {
    case "changes": {
      if (tab.kind !== "changes") return tab;
      const next = { ...tab, ...change.patch };

      return changesScopeValue(next.scope) === changesScopeValue(tab.scope) &&
        next.selectedPath === tab.selectedPath &&
        next.pathRevealRevision === tab.pathRevealRevision &&
        next.scrollTop === tab.scrollTop
        ? tab
        : next;
    }

    case "file":
      return tab.kind !== "file" || tab.preview === change.patch.preview
        ? tab
        : { ...tab, preview: change.patch.preview };
    case "browser":
      return tab.kind !== "browser" || tab.url === change.patch.url
        ? tab
        : { ...tab, url: change.patch.url };
    case "canvas": {
      if (tab.kind !== "canvas") return tab;
      const next = { ...tab, ...change.patch };

      return next.title === tab.title && next.pinned === tab.pinned ? tab : next;
    }

    default: {
      const _exhaustive: never = change;

      return _exhaustive;
    }
  }
}
