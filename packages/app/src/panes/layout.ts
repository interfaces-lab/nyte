import { asId } from "@nyte-ai/schema";
import type { Id } from "@nyte-ai/schema";

export type PaneId = Id<"pane">;

export type PaneTabId = Id<"pane-tab">;

export type SplitId = Id<"split">;

export type SplitDirection = "right" | "down";

export interface TabContent {
  readonly kind: string;
}

export interface PaneTab<Content extends TabContent> {
  readonly id: PaneTabId;
  readonly content: Content;
}

export interface Pane<Content extends TabContent> {
  readonly kind: "pane";
  readonly id: PaneId;
  readonly tab: PaneTab<Content>;
}

export type PaneSize = number | { readonly px: number };

export interface SplitChild<Content extends TabContent> {
  readonly node: LayoutNode<Content>;
  readonly size: PaneSize;
}

type SplitChildren<Content extends TabContent> = readonly [
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

export interface Layout<Content extends TabContent> {
  readonly root: LayoutNode<Content>;
  readonly focus: readonly [PaneId, ...PaneId[]];
}

type TabPlace =
  | { readonly kind: "focused" }
  | {
      readonly kind: "edge";
      readonly pane: PaneId;
      readonly direction: SplitDirection;
      readonly side: "before" | "after";
    };

export type LayoutAction<Content extends TabContent> =
  | { readonly kind: "open"; readonly content: Content; readonly place: TabPlace }
  | { readonly kind: "move"; readonly tab: PaneTabId; readonly place: TabPlace }
  | { readonly kind: "activate"; readonly tab: PaneTabId }
  | { readonly kind: "close"; readonly tab: PaneTabId }
  | { readonly kind: "set-content"; readonly tab: PaneTabId; readonly content: Content }
  | { readonly kind: "resize"; readonly split: SplitId; readonly sizes: readonly PaneSize[] }
  | { readonly kind: "focus"; readonly pane: PaneId };

export interface LayoutRules<Content extends TabContent> {
  readonly identify: (content: Content) => string | undefined;
  readonly newId: () => string;
}

export const MAX_PANES = 6;

export function sizeWeight(size: PaneSize): number {
  return typeof size === "number" ? size : 0;
}

export function createLayout<Content extends TabContent>(
  content: Content,
  rules: Pick<LayoutRules<Content>, "newId">,
): Layout<Content> {
  const pane = newPane(content, rules);

  return { root: pane, focus: [pane.id] };
}

export function layoutPanes<Content extends TabContent>(
  node: LayoutNode<Content>,
): readonly Pane<Content>[] {
  return node.kind === "pane" ? [node] : node.children.flatMap((child) => layoutPanes(child.node));
}

function findPane<Content extends TabContent>(
  layout: Layout<Content>,
  id: PaneId,
): Pane<Content> | undefined {
  return layoutPanes(layout.root).find((pane) => pane.id === id);
}

export function focusedPane<Content extends TabContent>(layout: Layout<Content>): Pane<Content> {
  return findPane(layout, layout.focus[0]) ?? firstPane(layout.root);
}

function paneOfTab<Content extends TabContent>(
  layout: Layout<Content>,
  tab: PaneTabId,
): Pane<Content> | undefined {
  return layoutPanes(layout.root).find((pane) => pane.tab.id === tab);
}

export function tabShown<Content extends TabContent>(
  layout: Layout<Content>,
  tab: PaneTabId,
): boolean {
  return paneOfTab(layout, tab) !== undefined;
}

export function reduceLayout<Content extends TabContent>(
  layout: Layout<Content>,
  action: LayoutAction<Content>,
  rules: LayoutRules<Content>,
): Layout<Content> {
  switch (action.kind) {
    case "open":
      return open(layout, action.content, action.place, rules);
    case "move":
      return move(layout, action.tab, action.place, rules);
    case "activate":
      return activate(layout, action.tab);
    case "close":
      return close(layout, action.tab);
    case "set-content":
      return setContent(layout, action.tab, action.content);
    case "resize":
      return resize(layout, action.split, action.sizes);
    case "focus":
      return focus(layout, action.pane);
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
  rules: LayoutRules<Content>,
): Layout<Content> {
  const identity = rules.identify(content);

  const existing =
    identity === undefined
      ? undefined
      : layoutPanes(layout.root).find((pane) => rules.identify(pane.tab.content) === identity);

  if (existing !== undefined) return focus(layout, existing.id);

  return placeTab(layout, { id: asId<"pane-tab">(rules.newId()), content }, place, rules);
}

function move<Content extends TabContent>(
  layout: Layout<Content>,
  tabId: PaneTabId,
  place: TabPlace,
  rules: LayoutRules<Content>,
): Layout<Content> {
  const source = paneOfTab(layout, tabId);

  if (source === undefined || targetPane(place) === source.id) return layout;
  const without = removeTab(layout, tabId);

  if (without === undefined) return layout;
  const moved = placeTab(without, source.tab, place, rules);

  return moved === without ? layout : moved;
}

function activate<Content extends TabContent>(
  layout: Layout<Content>,
  tabId: PaneTabId,
): Layout<Content> {
  const pane = paneOfTab(layout, tabId);

  return pane === undefined ? layout : focus(layout, pane.id);
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

  if (
    pane === undefined ||
    pane.tab.content === content ||
    pane.tab.content.kind !== content.kind
  ) {
    return layout;
  }

  return replacePane(layout, { ...pane, tab: { id: tabId, content } });
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
        typeof size === "number"
          ? child.size === size
          : typeof child.size !== "number" && child.size.px === size.px;

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
  if (findPane(layout, paneId) === undefined || layout.focus[0] === paneId) return layout;

  return { ...layout, focus: [paneId, ...layout.focus.filter((id) => id !== paneId)] };
}

function placeTab<Content extends TabContent>(
  layout: Layout<Content>,
  tab: PaneTab<Content>,
  place: TabPlace,
  rules: LayoutRules<Content>,
): Layout<Content> {
  switch (place.kind) {
    case "focused": {
      const pane = focusedPane(layout);

      return focus(replacePane(layout, { ...pane, tab }), pane.id);
    }

    case "edge":
      return besidePane(layout, tab, place.pane, place.direction, place.side, rules);
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

function besidePane<Content extends TabContent>(
  layout: Layout<Content>,
  tab: PaneTab<Content>,
  target: PaneId,
  direction: SplitDirection,
  side: "before" | "after",
  rules: LayoutRules<Content>,
): Layout<Content> {
  if (layoutPanes(layout.root).length >= MAX_PANES || findPane(layout, target) === undefined) {
    return layout;
  }

  const pane: Pane<Content> = { kind: "pane", id: asId<"pane">(rules.newId()), tab };

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
    const placed: SplitChild<Content> = { node: pane, size: 1 };
    const kept: SplitChild<Content> = { node, size: 1 };

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

function splitSize<Content extends TabContent>(
  size: PaneSize,
  siblings: SplitChildren<Content>,
): { readonly kept: PaneSize; readonly added: PaneSize } {
  if (typeof size === "number") return { kept: size / 2, added: size / 2 };
  const weights = siblings.flatMap((child) => (typeof child.size === "number" ? [child.size] : []));

  const added =
    weights.length === 0 ? 1 : weights.reduce((sum, value) => sum + value, 0) / weights.length;

  return { kept: size, added };
}

function removeTab<Content extends TabContent>(
  layout: Layout<Content>,
  tabId: PaneTabId,
): Layout<Content> | undefined {
  const pane = paneOfTab(layout, tabId);

  if (pane === undefined) return undefined;
  const root = removePane(layout.root, pane.id);

  return root === undefined ? undefined : normalizeLayout({ ...layout, root });
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

function flatten<Content extends TabContent>(
  direction: SplitDirection,
  children: readonly SplitChild<Content>[],
): readonly SplitChild<Content>[] {
  return children.flatMap((child): SplitChild<Content>[] => {
    if (child.node.kind !== "split" || child.node.direction !== direction) return [child];
    const inner = child.node.children;

    const total = inner.reduce((sum, entry) => sum + sizeWeight(entry.size), 0);
    const outer = child.size;

    return inner.map((entry) =>
      typeof entry.size === "number" && typeof outer === "number" && total > 0
        ? { node: entry.node, size: (entry.size / total) * outer }
        : entry,
    );
  });
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

export function normalizeLayout<Content extends TabContent>(
  layout: Layout<Content>,
): Layout<Content> {
  const panes = layoutPanes(layout.root);
  const known = layout.focus.filter((id) => panes.some((pane) => pane.id === id));
  const missing = panes.filter((pane) => !known.includes(pane.id)).map((pane) => pane.id);
  const ordered = [...known, ...missing];
  const head = ordered[0] ?? firstPane(layout.root).id;

  return { root: layout.root, focus: [head, ...ordered.filter((id) => id !== head)] };
}

function firstPane<Content extends TabContent>(node: LayoutNode<Content>): Pane<Content> {
  return node.kind === "pane" ? node : firstPane(node.children[0].node);
}

function newPane<Content extends TabContent>(
  content: Content,
  rules: Pick<LayoutRules<Content>, "newId">,
): Pane<Content> {
  const tab = { id: asId<"pane-tab">(rules.newId()), content };

  return { kind: "pane", id: asId<"pane">(rules.newId()), tab };
}

function targetPane(place: TabPlace): PaneId | undefined {
  return place.kind === "edge" ? place.pane : undefined;
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
