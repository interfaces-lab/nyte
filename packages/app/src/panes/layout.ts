import { asId } from "@nyte-ai/schema";
import type { Id } from "@nyte-ai/schema";

export type PaneId = Id<"pane">;

export type PaneTabId = Id<"pane-tab">;

export type SplitId = Id<"split">;

export type SplitDirection = "right" | "down";

/** What a pane tab shows. The layout reads only `kind`; the kind's own module owns the rest. */
export interface TabContent {
  readonly kind: string;
}

export interface PaneTab<Content extends TabContent> {
  readonly id: PaneTabId;
  readonly content: Content;
}

export type PaneTabs<Content extends TabContent> = readonly [
  PaneTab<Content>,
  ...PaneTab<Content>[],
];

export interface Pane<Content extends TabContent> {
  readonly kind: "pane";
  readonly id: PaneId;
  readonly tabs: PaneTabs<Content>;
  readonly active: PaneTabId;
  /** Out of view with its size kept, as the explorer is after ⌘B. */
  readonly hidden: boolean;
}

/** A share divides the room the pixel-sized children leave. */
export type PaneSize =
  | { readonly kind: "share"; readonly share: number }
  | { readonly kind: "pixels"; readonly pixels: number };

export interface SplitChild<Content extends TabContent> {
  readonly node: LayoutNode<Content>;
  readonly size: PaneSize;
}

export type SplitChildren<Content extends TabContent> = readonly [
  SplitChild<Content>,
  SplitChild<Content>,
  ...SplitChild<Content>[],
];

export interface Split<Content extends TabContent> {
  readonly kind: "split";
  readonly id: SplitId;
  readonly direction: SplitDirection;
  readonly children: SplitChildren<Content>;
}

export type LayoutNode<Content extends TabContent> = Pane<Content> | Split<Content>;

/** The splits and panes of one window tab. `focus` runs from the focused pane to the least recent. */
export interface Layout<Content extends TabContent> {
  readonly root: LayoutNode<Content>;
  readonly focus: readonly [PaneId, ...PaneId[]];
  readonly zoomed: PaneId | null;
}

/** Where a tab lands: a pane's tab row, or a new pane beside one. */
export type TabPlace =
  | { readonly kind: "focused" }
  | { readonly kind: "pane"; readonly pane: PaneId; readonly index: number }
  | {
      readonly kind: "edge";
      readonly pane: PaneId;
      readonly direction: SplitDirection;
      readonly side: "before" | "after";
    }
  /** The most recently focused pane holding a tab of this kind, else a new pane after the focused one. */
  | { readonly kind: "for"; readonly tabKind: string };

export type LayoutAction<Content extends TabContent> =
  | {
      readonly kind: "open";
      readonly content: Content;
      readonly place: TabPlace;
      readonly activate: boolean;
    }
  | { readonly kind: "move"; readonly tab: PaneTabId; readonly place: TabPlace }
  | { readonly kind: "activate"; readonly tab: PaneTabId }
  | { readonly kind: "close"; readonly tab: PaneTabId }
  | { readonly kind: "set-content"; readonly tab: PaneTabId; readonly content: Content }
  | { readonly kind: "split"; readonly pane: PaneId; readonly direction: SplitDirection }
  | { readonly kind: "resize"; readonly split: SplitId; readonly sizes: readonly PaneSize[] }
  | { readonly kind: "focus"; readonly pane: PaneId }
  | { readonly kind: "zoom"; readonly pane: PaneId | null }
  | { readonly kind: "toggle-hidden"; readonly pane: PaneId };

/** What the layout asks of the kinds it holds, and where new ids come from. */
export interface LayoutRules<Content extends TabContent> {
  /** Opening content whose identity matches an open tab shows that tab instead. */
  readonly identify: (content: Content) => string | undefined;
  /** A replaceable tab gives way to the next tab of its kind opened in its pane, as a preview does. */
  readonly replaceable: (content: Content) => boolean;
  readonly newId: () => string;
}

export const MAX_PANES = 6;

export function createLayout<Content extends TabContent>(
  content: Content,
  rules: Pick<LayoutRules<Content>, "newId">,
): Layout<Content> {
  const pane = newPane(content, rules);

  return { root: pane, focus: [pane.id], zoomed: null };
}

/** Every pane in reading order. */
export function layoutPanes<Content extends TabContent>(
  node: LayoutNode<Content>,
): readonly Pane<Content>[] {
  return node.kind === "pane" ? [node] : node.children.flatMap((child) => layoutPanes(child.node));
}

export function findPane<Content extends TabContent>(
  layout: Layout<Content>,
  id: PaneId,
): Pane<Content> | undefined {
  return layoutPanes(layout.root).find((pane) => pane.id === id);
}

export function focusedPane<Content extends TabContent>(layout: Layout<Content>): Pane<Content> {
  return findPane(layout, layout.focus[0]) ?? firstPane(layout.root);
}

export function activeTab<Content extends TabContent>(pane: Pane<Content>): PaneTab<Content> {
  return pane.tabs.find((tab) => tab.id === pane.active) ?? pane.tabs[0];
}

export function paneOfTab<Content extends TabContent>(
  layout: Layout<Content>,
  tab: PaneTabId,
): Pane<Content> | undefined {
  return layoutPanes(layout.root).find((pane) => pane.tabs.some((entry) => entry.id === tab));
}

/** A tab is shown when its pane is in view and it is the pane's active tab. */
export function tabShown<Content extends TabContent>(
  layout: Layout<Content>,
  tab: PaneTabId,
): boolean {
  const pane = paneOfTab(layout, tab);

  return (
    pane !== undefined &&
    !pane.hidden &&
    pane.active === tab &&
    (layout.zoomed === null || layout.zoomed === pane.id)
  );
}

export function reduceLayout<Content extends TabContent>(
  layout: Layout<Content>,
  action: LayoutAction<Content>,
  rules: LayoutRules<Content>,
): Layout<Content> {
  switch (action.kind) {
    case "open":
      return open(layout, action.content, action.place, action.activate, rules);
    case "move":
      return move(layout, action.tab, action.place, rules);
    case "activate":
      return activate(layout, action.tab);
    case "close":
      return close(layout, action.tab);
    case "set-content":
      return setContent(layout, action.tab, action.content);
    case "split":
      return split(layout, action.pane, action.direction, rules);
    case "resize":
      return resize(layout, action.split, action.sizes);
    case "focus":
      return focus(layout, action.pane);
    case "zoom":
      return zoom(layout, action.pane);
    case "toggle-hidden":
      return toggleHidden(layout, action.pane);
    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }
}

function open<Content extends TabContent>(
  layout: Layout<Content>,
  content: Content,
  place: TabPlace,
  activate: boolean,
  rules: LayoutRules<Content>,
): Layout<Content> {
  const identity = rules.identify(content);

  const existing =
    identity === undefined
      ? undefined
      : layoutPanes(layout.root)
          .flatMap((pane) => pane.tabs)
          .find((tab) => rules.identify(tab.content) === identity);

  if (existing !== undefined) return activate ? activateTab(layout, existing.id) : layout;
  const tab = { id: asId<"pane-tab">(rules.newId()), content };

  return place.kind === "pane"
    ? insertTab(layout, tab, place.pane, place.index, activate)
    : placeTab(layout, tab, place, activate, rules);
}

function move<Content extends TabContent>(
  layout: Layout<Content>,
  tabId: PaneTabId,
  place: TabPlace,
  rules: LayoutRules<Content>,
): Layout<Content> {
  const source = paneOfTab(layout, tabId);
  const tab = source?.tabs.find((entry) => entry.id === tabId);

  if (source === undefined || tab === undefined) return layout;

  if (place.kind === "pane" && place.pane === source.id) {
    const others = source.tabs.filter((entry) => entry.id !== tabId);
    const tabs = insertAt(others, place.index, tab);
    const same = tabs.every((entry, at) => entry === source.tabs[at]);

    return same
      ? focusAndActivate(layout, source.id, tabId)
      : focusAndActivate(replacePane(layout, { ...source, tabs }), source.id, tabId);
  }

  if (source.tabs.length === 1 && targetPane(place) === source.id) return layout;
  const without = removeTab(layout, tabId);

  if (without === undefined) return layout;

  const moved =
    place.kind === "pane"
      ? insertTab(without, tab, place.pane, place.index, true)
      : placeTab(without, tab, place, true, rules);

  return moved === without ? layout : moved;
}

function activate<Content extends TabContent>(
  layout: Layout<Content>,
  tabId: PaneTabId,
): Layout<Content> {
  return paneOfTab(layout, tabId) === undefined ? layout : activateTab(layout, tabId);
}

function close<Content extends TabContent>(
  layout: Layout<Content>,
  tabId: PaneTabId,
): Layout<Content> {
  return removeTab(layout, tabId) ?? layout;
}

function setContent<Content extends TabContent>(
  layout: Layout<Content>,
  tabId: PaneTabId,
  content: Content,
): Layout<Content> {
  const pane = paneOfTab(layout, tabId);
  const current = pane?.tabs.find((tab) => tab.id === tabId);

  if (
    pane === undefined ||
    current === undefined ||
    current.content === content ||
    current.content.kind !== content.kind
  )
    return layout;
  const tabs = mapTabs(pane.tabs, (tab) => (tab.id === tabId ? { id: tab.id, content } : tab));

  return replacePane(layout, { ...pane, tabs });
}

/** Moves the pane's active tab into a new pane after it; a pane with one tab has nothing to split off. */
function split<Content extends TabContent>(
  layout: Layout<Content>,
  paneId: PaneId,
  direction: SplitDirection,
  rules: LayoutRules<Content>,
): Layout<Content> {
  const pane = findPane(layout, paneId);

  if (pane === undefined || pane.tabs.length < 2) return layout;

  return move(layout, pane.active, { kind: "edge", pane: paneId, direction, side: "after" }, rules);
}

function resize<Content extends TabContent>(
  layout: Layout<Content>,
  splitId: SplitId,
  sizes: readonly PaneSize[],
): Layout<Content> {
  const root = mapSplit(layout.root, splitId, (node) => {
    if (sizes.length !== node.children.length) return node;

    const children = node.children.map((child, index) => {
      const size = sizes[index] ?? child.size;

      const same =
        size.kind === "share"
          ? child.size.kind === "share" && child.size.share === size.share
          : child.size.kind === "pixels" && child.size.pixels === size.pixels;

      return same ? child : { node: child.node, size };
    });

    if (children.every((child, index) => child === node.children[index])) return node;
    const resized = atLeastTwo(children);

    return resized === undefined ? node : { ...node, children: resized };
  });

  return root === layout.root ? layout : { ...layout, root };
}

function focus<Content extends TabContent>(
  layout: Layout<Content>,
  paneId: PaneId,
): Layout<Content> {
  const pane = findPane(layout, paneId);

  if (pane === undefined || pane.hidden || layout.focus[0] === paneId) return layout;

  return { ...layout, focus: [paneId, ...layout.focus.filter((id) => id !== paneId)] };
}

function zoom<Content extends TabContent>(
  layout: Layout<Content>,
  paneId: PaneId | null,
): Layout<Content> {
  if (paneId === layout.zoomed) return layout;

  if (paneId === null) return { ...layout, zoomed: null };
  const pane = findPane(layout, paneId);

  if (pane === undefined || pane.hidden) return layout;

  return { ...focus(layout, paneId), zoomed: paneId };
}

function toggleHidden<Content extends TabContent>(
  layout: Layout<Content>,
  paneId: PaneId,
): Layout<Content> {
  const pane = findPane(layout, paneId);

  if (pane === undefined) return layout;

  if (pane.hidden) return focus(replacePane(layout, { ...pane, hidden: false }), paneId);

  const visible = layoutPanes(layout.root).filter((entry) => !entry.hidden);

  if (visible.length < 2) return layout;
  const hidden = replacePane(layout, { ...pane, hidden: true });
  const next = layout.focus.find((id) => id !== paneId && visible.some((entry) => entry.id === id));
  const focused = next === undefined ? hidden : focus(hidden, next);

  return focused.zoomed === paneId ? { ...focused, zoomed: null } : focused;
}

function placeTab<Content extends TabContent>(
  layout: Layout<Content>,
  tab: PaneTab<Content>,
  place: Exclude<TabPlace, { readonly kind: "pane" }>,
  activate: boolean,
  rules: LayoutRules<Content>,
): Layout<Content> {
  switch (place.kind) {
    case "focused":
      return intoPane(layout, tab, focusedPane(layout), activate, rules);
    case "edge":
      return besidePane(layout, tab, place.pane, place.direction, place.side, rules);
    case "for": {
      const holder = layout.focus
        .map((id) => findPane(layout, id))
        .find((pane) => pane?.tabs.some((entry) => entry.content.kind === place.tabKind));

      if (holder !== undefined) return intoPane(layout, tab, holder, activate, rules);
      const beside = besidePane(layout, tab, focusedPane(layout).id, "right", "after", rules);

      return beside === layout
        ? intoPane(layout, tab, focusedPane(layout), activate, rules)
        : beside;
    }

    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

/** Takes the place of a replaceable tab of the same kind, else goes after the active tab. */
function intoPane<Content extends TabContent>(
  layout: Layout<Content>,
  tab: PaneTab<Content>,
  pane: Pane<Content>,
  activate: boolean,
  rules: LayoutRules<Content>,
): Layout<Content> {
  const replaced = pane.tabs.find(
    (entry) => entry.content.kind === tab.content.kind && rules.replaceable(entry.content),
  );

  if (replaced !== undefined) {
    const tabs = mapTabs(pane.tabs, (entry) => (entry === replaced ? tab : entry));
    const active = pane.active === replaced.id ? tab.id : pane.active;
    const next = replacePane(layout, { ...pane, tabs, active });

    return activate ? focusAndActivate(next, pane.id, tab.id) : next;
  }

  const after = pane.tabs.findIndex((entry) => entry.id === pane.active) + 1;

  return insertTab(layout, tab, pane.id, after, activate);
}

function insertTab<Content extends TabContent>(
  layout: Layout<Content>,
  tab: PaneTab<Content>,
  paneId: PaneId,
  index: number,
  activate: boolean,
): Layout<Content> {
  const pane = findPane(layout, paneId);

  if (pane === undefined) return layout;
  const next = replacePane(layout, { ...pane, tabs: insertAt(pane.tabs, index, tab) });

  return activate ? focusAndActivate(next, pane.id, tab.id) : next;
}

function besidePane<Content extends TabContent>(
  layout: Layout<Content>,
  tab: PaneTab<Content>,
  target: PaneId,
  direction: SplitDirection,
  side: "before" | "after",
  rules: LayoutRules<Content>,
): Layout<Content> {
  if (layoutPanes(layout.root).length >= MAX_PANES || findPane(layout, target) === undefined)
    return layout;

  const pane: Pane<Content> = {
    kind: "pane",
    id: asId<"pane">(rules.newId()),
    tabs: [tab],
    active: tab.id,
    hidden: false,
  };

  const root = insertBeside(layout.root, target, pane, direction, side, rules);

  return focus({ ...layout, root, focus: [...layout.focus, pane.id] }, pane.id);
}

function insertBeside<Content extends TabContent>(
  node: LayoutNode<Content>,
  target: PaneId,
  pane: Pane<Content>,
  direction: SplitDirection,
  side: "before" | "after",
  rules: LayoutRules<Content>,
): LayoutNode<Content> {
  if (node.kind === "pane") {
    if (node.id !== target) return node;
    const placed: SplitChild<Content> = { node: pane, size: { kind: "share", share: 1 } };
    const kept: SplitChild<Content> = { node, size: { kind: "share", share: 1 } };

    return {
      kind: "split",
      id: asId<"split">(rules.newId()),
      direction,
      children: side === "before" ? [placed, kept] : [kept, placed],
    };
  }

  const index = node.children.findIndex(
    (child) => child.node.kind === "pane" && child.node.id === target,
  );

  const sibling = node.children[index];

  if (node.direction === direction && sibling !== undefined) {
    const sizes = splitSize(sibling.size, node.children);
    const placed = { node: pane, size: sizes.added };
    const kept = { node: sibling.node, size: sizes.kept };
    const pair = side === "before" ? [placed, kept] : [kept, placed];

    const children = atLeastTwo([
      ...node.children.slice(0, index),
      ...pair,
      ...node.children.slice(index + 1),
    ]);

    return children === undefined ? node : { ...node, children };
  }

  return replaceChildren(node, (child) =>
    insertBeside(child, target, pane, direction, side, rules),
  );
}

/** A share halves between the pane and its new neighbour; beside a pixel-sized pane, the newcomer takes an average share. */
function splitSize<Content extends TabContent>(
  size: PaneSize,
  siblings: SplitChildren<Content>,
): { readonly kept: PaneSize; readonly added: PaneSize } {
  if (size.kind === "share") {
    const half: PaneSize = { kind: "share", share: size.share / 2 };

    return { kept: half, added: half };
  }

  const shares = siblings.flatMap((child) =>
    child.size.kind === "share" ? [child.size.share] : [],
  );

  const share =
    shares.length === 0 ? 1 : shares.reduce((sum, value) => sum + value, 0) / shares.length;

  return { kept: size, added: { kind: "share", share } };
}

/** Removes a tab; an emptied pane leaves the tree. The last tab of the last pane stays. */
function removeTab<Content extends TabContent>(
  layout: Layout<Content>,
  tabId: PaneTabId,
): Layout<Content> | undefined {
  const pane = paneOfTab(layout, tabId);

  if (pane === undefined) return undefined;
  const index = pane.tabs.findIndex((tab) => tab.id === tabId);
  const rest = pane.tabs.filter((tab) => tab.id !== tabId);
  const first = rest[0];

  if (first !== undefined) {
    const neighbour = rest[index] ?? rest[index - 1] ?? first;
    const tabs: PaneTabs<Content> = [first, ...rest.slice(1)];
    const active = pane.active === tabId ? neighbour.id : pane.active;

    return replacePane(layout, { ...pane, tabs, active });
  }

  const root = removePane(layout.root, pane.id);

  if (root === undefined) return undefined;

  return normalizeLayout({ ...layout, root });
}

function removePane<Content extends TabContent>(
  node: LayoutNode<Content>,
  paneId: PaneId,
): LayoutNode<Content> | undefined {
  if (node.kind === "pane") return node.id === paneId ? undefined : node;
  let changed = false;

  const kept = node.children.flatMap((child): SplitChild<Content>[] => {
    const next = removePane(child.node, paneId);

    if (next === child.node) return [child];
    changed = true;

    return next === undefined ? [] : [{ node: next, size: child.size }];
  });

  if (!changed) return node;
  const only = kept[0];

  if (kept.length === 1 && only !== undefined) return only.node;
  const children = atLeastTwo(flatten(node.direction, kept));

  return children === undefined ? undefined : { ...node, children };
}

/** A child split running the same way as its parent gives its children to the parent. */
function flatten<Content extends TabContent>(
  direction: SplitDirection,
  children: readonly SplitChild<Content>[],
): readonly SplitChild<Content>[] {
  return children.flatMap((child): SplitChild<Content>[] => {
    if (child.node.kind !== "split" || child.node.direction !== direction) return [child];
    const inner = child.node.children;

    const total = inner.reduce(
      (sum, entry) => sum + (entry.size.kind === "share" ? entry.size.share : 0),
      0,
    );

    const outer = child.size;

    return inner.map((entry) =>
      entry.size.kind === "share" && outer.kind === "share" && total > 0
        ? {
            node: entry.node,
            size: { kind: "share", share: (entry.size.share / total) * outer.share },
          }
        : entry,
    );
  });
}

function activateTab<Content extends TabContent>(
  layout: Layout<Content>,
  tabId: PaneTabId,
): Layout<Content> {
  const pane = paneOfTab(layout, tabId);

  return pane === undefined ? layout : focusAndActivate(layout, pane.id, tabId);
}

function focusAndActivate<Content extends TabContent>(
  layout: Layout<Content>,
  paneId: PaneId,
  tabId: PaneTabId,
): Layout<Content> {
  const pane = findPane(layout, paneId);

  if (pane === undefined) return layout;

  const shown =
    pane.active === tabId && !pane.hidden
      ? layout
      : replacePane(layout, { ...pane, active: tabId, hidden: false });

  return focus(shown, paneId);
}

function replacePane<Content extends TabContent>(
  layout: Layout<Content>,
  pane: Pane<Content>,
): Layout<Content> {
  const root = mapPane(layout.root, pane);

  return root === layout.root ? layout : { ...layout, root };
}

function mapPane<Content extends TabContent>(
  node: LayoutNode<Content>,
  pane: Pane<Content>,
): LayoutNode<Content> {
  if (node.kind === "pane") return node.id === pane.id ? pane : node;

  return replaceChildren(node, (child) => mapPane(child, pane));
}

function mapSplit<Content extends TabContent>(
  node: LayoutNode<Content>,
  splitId: SplitId,
  update: (split: Split<Content>) => Split<Content>,
): LayoutNode<Content> {
  if (node.kind === "pane") return node;

  if (node.id === splitId) return update(node);

  return replaceChildren(node, (child) => mapSplit(child, splitId, update));
}

/** Rebuilds a split only when a child changed, so untouched subtrees keep their identity. */
function replaceChildren<Content extends TabContent>(
  node: Split<Content>,
  update: (child: LayoutNode<Content>) => LayoutNode<Content>,
): Split<Content> {
  const children = node.children.map((child) => {
    const next = update(child.node);

    return next === child.node ? child : { node: next, size: child.size };
  });

  if (children.every((child, index) => child === node.children[index])) return node;
  const rebuilt = atLeastTwo(children);

  return rebuilt === undefined ? node : { ...node, children: rebuilt };
}

/** Keeps `focus` to panes in the tree, in view first, and `zoomed` to a pane that exists. */
export function normalizeLayout<Content extends TabContent>(
  layout: Layout<Content>,
): Layout<Content> {
  const panes = layoutPanes(layout.root);
  const known = layout.focus.filter((id) => panes.some((pane) => pane.id === id));
  const missing = panes.filter((pane) => !known.includes(pane.id)).map((pane) => pane.id);
  const ordered = [...known, ...missing];
  const lead = ordered.find((id) => panes.some((pane) => pane.id === id && !pane.hidden));
  const head = lead ?? firstPane(layout.root).id;
  const focusOrder: Layout<Content>["focus"] = [head, ...ordered.filter((id) => id !== head)];

  const zoomed =
    layout.zoomed !== null && panes.some((pane) => pane.id === layout.zoomed)
      ? layout.zoomed
      : null;

  return { root: layout.root, focus: focusOrder, zoomed };
}

function firstPane<Content extends TabContent>(node: LayoutNode<Content>): Pane<Content> {
  return node.kind === "pane" ? node : firstPane(node.children[0].node);
}

function newPane<Content extends TabContent>(
  content: Content,
  rules: Pick<LayoutRules<Content>, "newId">,
): Pane<Content> {
  const tab = { id: asId<"pane-tab">(rules.newId()), content };

  return {
    kind: "pane",
    id: asId<"pane">(rules.newId()),
    tabs: [tab],
    active: tab.id,
    hidden: false,
  };
}

function targetPane(place: TabPlace): PaneId | undefined {
  return place.kind === "pane" || place.kind === "edge" ? place.pane : undefined;
}

function mapTabs<Content extends TabContent>(
  tabs: PaneTabs<Content>,
  update: (tab: PaneTab<Content>) => PaneTab<Content>,
): PaneTabs<Content> {
  return [update(tabs[0]), ...tabs.slice(1).map(update)];
}

/** `tabs` with `tab` at `index`, clamped to the row. */
function insertAt<Content extends TabContent>(
  tabs: readonly PaneTab<Content>[],
  index: number,
  tab: PaneTab<Content>,
): PaneTabs<Content> {
  const at = Math.max(0, Math.min(index, tabs.length));
  const before = tabs.slice(0, at);
  const head = before[0];

  return head === undefined ? [tab, ...tabs] : [head, ...before.slice(1), tab, ...tabs.slice(at)];
}

function atLeastTwo<Content extends TabContent>(
  children: readonly SplitChild<Content>[],
): SplitChildren<Content> | undefined {
  const first = children[0];
  const second = children[1];

  return first === undefined || second === undefined
    ? undefined
    : [first, second, ...children.slice(2)];
}
