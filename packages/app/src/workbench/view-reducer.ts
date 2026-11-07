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
  EditorGroupId,
  KindTab,
  WorkbenchChangesScope,
  WorkbenchTab,
  WorkbenchTabId,
  WorkbenchViewState,
} from "./model.ts";

type ChangesTab = KindTab<"changes">;

type CanvasTab = KindTab<"canvas">;

type WorkbenchTabPatch =
  | {
      readonly kind: "changes";
      readonly patch: Partial<
        Pick<ChangesTab, "scope" | "selectedPath" | "pathRevealRevision" | "scrollTop">
      >;
    }
  | {
      readonly kind: "file";
      readonly patch: Partial<Pick<KindTab<"file">, "path" | "preview">>;
    }
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
  | { readonly kind: "set-width"; readonly pixels: number }
  | { readonly kind: "toggle-sidebar"; readonly slot: string }
  /** Opens `tab` in a new group, `group`, beside the focused one. */
  | {
      readonly kind: "split";
      readonly tab: KindTab<"file">;
      readonly group: EditorGroupId;
      readonly side: Side;
    }
  /**
   * Moves the file tab `id` into the group `into`, or into a new group, `group`, beside it. A
   * group that holds the same file already shows that tab instead.
   */
  | {
      readonly kind: "place";
      readonly id: WorkbenchTabId;
      readonly into: EditorGroupId;
      readonly zone: Side | "center";
      readonly group: EditorGroupId;
    }
  | { readonly kind: "focus-group"; readonly group: EditorGroupId };

type Side = "before" | "after";

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
    case "set-width": {
      const pixels = Math.round(action.pixels);

      return state.width.pixels === pixels ? state : { ...state, width: { pixels } };
    }

    case "split":
      return activate(
        {
          ...state,
          tabs: [...state.tabs, { ...action.tab, group: action.group }],
          groups: besideGroup(state, state.group, action.side, action.group),
        },
        action.tab.id,
      );
    case "place":
      return place(state, action);
    case "focus-group": {
      const target = state.groups.find((group) => group.id === action.group);

      if (target === undefined || action.group === state.group) return state;

      return target.active === null
        ? { ...state, group: action.group }
        : activate(state, target.active);
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
  const tab = state.tabs.find((candidate) => candidate.id === id);
  const group = tab?.kind === "file" ? tab.group : undefined;

  if (
    state.active === id &&
    state.expanded &&
    layout === state.layout &&
    (group === undefined || state.group === group)
  )
    return state;

  const shown = { ...state, active: id, expanded: true, layout };

  if (group === undefined) return shown;

  return {
    ...shown,
    group,
    groups: state.groups.map((entry) => (entry.id === group ? { ...entry, active: id } : entry)),
  };
}

function besideGroup(
  state: WorkbenchViewState,
  anchor: EditorGroupId,
  side: Side,
  id: EditorGroupId,
): WorkbenchViewState["groups"] {
  const at = state.groups.findIndex((group) => group.id === anchor) + (side === "after" ? 1 : 0);

  return [...state.groups.slice(0, at), { id, active: null }, ...state.groups.slice(at)];
}

function place(
  state: WorkbenchViewState,
  action: Extract<WorkbenchViewAction, { readonly kind: "place" }>,
): WorkbenchViewState {
  const moved = state.tabs.find((tab) => tab.id === action.id);

  if (moved?.kind !== "file") return state;

  if (action.zone === "center") {
    const twin = state.tabs.find(
      (tab) => tab.kind === "file" && tab.group === action.into && tab.path === moved.path,
    );

    if (twin !== undefined)
      return twin.id === moved.id
        ? activate(state, moved.id)
        : activate(close(state, moved.id), twin.id);

    return activate(withGroup(state, moved, action.into), moved.id);
  }

  const split = { ...state, groups: besideGroup(state, action.into, action.zone, action.group) };

  return activate(withGroup(split, moved, action.group), moved.id);
}

/** Moves `tab` into `group`; the group it leaves closes once it holds nothing, unless it's the last. */
function withGroup(
  state: WorkbenchViewState,
  tab: KindTab<"file">,
  group: EditorGroupId,
): WorkbenchViewState {
  const tabs = state.tabs.map((candidate) =>
    candidate.id === tab.id ? { ...tab, group } : candidate,
  );

  const left = state.groups.map((entry) =>
    entry.id === tab.group && entry.active === tab.id
      ? { ...entry, active: groupNeighbour(state.tabs, tab) }
      : entry,
  );

  return pruneGroups({ ...state, tabs, groups: left });
}

/** The file tab a group shows once `tab` leaves it: the one after it, else the one before. */
function groupNeighbour(
  tabs: readonly WorkbenchTab[],
  tab: KindTab<"file">,
): WorkbenchTabId | null {
  const siblings = tabs.filter(
    (candidate) => candidate.kind === "file" && candidate.group === tab.group,
  );

  const index = siblings.findIndex((candidate) => candidate.id === tab.id);

  return siblings[index + 1]?.id ?? siblings[index - 1]?.id ?? null;
}

function pruneGroups(state: WorkbenchViewState): WorkbenchViewState {
  const held = new Set(state.tabs.flatMap((tab) => (tab.kind === "file" ? [tab.group] : [])));
  const kept = state.groups.filter((group) => held.has(group.id));
  const groups = kept.length === 0 ? state.groups.slice(0, 1) : kept;

  if (groups.length === state.groups.length) return state;
  const index = state.groups.findIndex((group) => group.id === state.group);

  const focused = groups.some((group) => group.id === state.group)
    ? state.group
    : ((groups[Math.min(index, groups.length - 1)] ?? groups[0])?.id ?? state.group);

  return { ...state, groups, group: focused };
}

function close(state: WorkbenchViewState, id: WorkbenchTabId): WorkbenchViewState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  const closed = state.tabs[index];

  if (closed === undefined) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  const sibling = closed.kind === "file" ? groupNeighbour(state.tabs, closed) : null;

  const groups =
    closed.kind === "file"
      ? state.groups.map((group) => (group.active === id ? { ...group, active: sibling } : group))
      : state.groups;

  const pruned = pruneGroups({ ...state, tabs, groups });

  const active =
    state.active === id
      ? (sibling ??
        pruned.groups.find((group) => group.id === pruned.group)?.active ??
        tabs[index]?.id ??
        tabs[index - 1]?.id ??
        null)
      : state.active;

  const selected = state.active === id && active !== null ? activate(pruned, active) : pruned;
  const slot = tabSlot(closed);

  return {
    ...selected,
    active,
    layout: state.layout,
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

    case "file": {
      if (tab.kind !== "file") return tab;
      const next = { ...tab, ...change.patch };

      return next.path === tab.path && next.preview === tab.preview ? tab : next;
    }

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
