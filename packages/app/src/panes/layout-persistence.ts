import { asId } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { layoutPanes, normalizeLayout } from "./layout.ts";
import type { Layout, LayoutNode, Pane, PaneTab, SplitChild, TabContent } from "./layout.ts";

/** A tab as stored: its kind names the module that owns `fields`. */
export interface StoredContent {
  readonly kind: string;
  readonly fields: unknown;
}

const strict = { additionalProperties: false };

const nonEmpty = Type.String({ minLength: 1 });

const sizeSchema = Type.Union([
  Type.Object({ kind: Type.Literal("share"), share: Type.Number({ exclusiveMinimum: 0 }) }, strict),
  Type.Object({ kind: Type.Literal("pixels"), pixels: Type.Number({ minimum: 0 }) }, strict),
]);

const tabSchema = Type.Object({ id: nonEmpty, kind: nonEmpty, fields: Type.Unknown() }, strict);

const paneSchema = Type.Object(
  {
    kind: Type.Literal("pane"),
    id: nonEmpty,
    tabs: Type.Array(tabSchema),
    active: Type.String(),
    hidden: Type.Boolean(),
  },
  strict,
);

const splitSchema = Type.Object(
  {
    kind: Type.Literal("split"),
    id: nonEmpty,
    direction: Type.Union([Type.Literal("right"), Type.Literal("down")]),
    children: Type.Array(Type.Object({ node: Type.Unknown(), size: sizeSchema }, strict)),
  },
  strict,
);

/** Nodes nest, so the root is checked one level at a time as it is restored. */
export const storedLayoutSchema = Type.Object(
  {
    root: Type.Unknown(),
    focus: Type.Array(nonEmpty),
    zoomed: Type.Union([nonEmpty, Type.Null()]),
  },
  strict,
);

export type StoredLayout = Static<typeof storedLayoutSchema>;

type StoredNode = Static<typeof paneSchema> | Static<typeof splitSchema>;

/** A tab its kind doesn't keep is left out; a pane left with no tabs drops on restore. */
export function persistLayout<Content extends TabContent>(
  layout: Layout<Content>,
  persist: (content: Content) => StoredContent | undefined,
): StoredLayout {
  return {
    root: persistNode(layout.root, persist),
    focus: [...layout.focus],
    zoomed: layout.zoomed,
  };
}

/**
 * Restores what its kinds still accept. A tab of an unknown kind or with fields its kind rejects
 * drops alone; a pane with no tab left drops, and a split with one child left gives way to it.
 */
export function restoreLayout<Content extends TabContent>(
  stored: StoredLayout,
  restore: (stored: StoredContent) => Content | undefined,
): Layout<Content> | undefined {
  const root = restoreNode(stored.root, restore);

  if (root === undefined || !uniqueIds(root)) return undefined;
  const head = stored.focus[0] ?? "";

  return normalizeLayout({
    root,
    focus: [asId<"pane">(head), ...stored.focus.slice(1).map((id) => asId<"pane">(id))],
    zoomed: stored.zoomed === null ? null : asId<"pane">(stored.zoomed),
  });
}

function persistNode<Content extends TabContent>(
  node: LayoutNode<Content>,
  persist: (content: Content) => StoredContent | undefined,
): StoredNode {
  if (node.kind === "pane") {
    return {
      kind: "pane",
      id: node.id,
      tabs: node.tabs.flatMap((tab) => {
        const stored = persist(tab.content);

        return stored === undefined
          ? []
          : [{ id: tab.id, kind: stored.kind, fields: stored.fields }];
      }),
      active: node.active,
      hidden: node.hidden,
    };
  }

  return {
    kind: "split",
    id: node.id,
    direction: node.direction,
    children: node.children.map((child) => ({
      node: persistNode(child.node, persist),
      size: child.size,
    })),
  };
}

function restoreNode<Content extends TabContent>(
  stored: unknown,
  restore: (stored: StoredContent) => Content | undefined,
): LayoutNode<Content> | undefined {
  if (Value.Check(paneSchema, stored)) return restorePane(stored, restore);

  if (!Value.Check(splitSchema, stored)) return undefined;

  const children = stored.children.flatMap((child): SplitChild<Content>[] => {
    const node = restoreNode(child.node, restore);

    return node === undefined ? [] : [{ node, size: child.size }];
  });

  const first = children[0];
  const second = children[1];

  if (first === undefined) return undefined;

  if (second === undefined) return first.node;

  return {
    kind: "split",
    id: asId<"split">(stored.id),
    direction: stored.direction,
    children: [first, second, ...children.slice(2)],
  };
}

function restorePane<Content extends TabContent>(
  stored: Static<typeof paneSchema>,
  restore: (stored: StoredContent) => Content | undefined,
): Pane<Content> | undefined {
  const tabs = stored.tabs.flatMap((tab): PaneTab<Content>[] => {
    const content = restore({ kind: tab.kind, fields: tab.fields });

    return content === undefined ? [] : [{ id: asId<"pane-tab">(tab.id), content }];
  });

  const first = tabs[0];

  if (first === undefined) return undefined;
  const active = tabs.find((tab) => tab.id === stored.active)?.id ?? first.id;

  return {
    kind: "pane",
    id: asId<"pane">(stored.id),
    tabs: [first, ...tabs.slice(1)],
    active,
    hidden: stored.hidden,
  };
}

/** Two panes or tabs with one id would make every lookup ambiguous, so such a layout is corrupt. */
function uniqueIds<Content extends TabContent>(root: LayoutNode<Content>): boolean {
  const panes = layoutPanes(root);

  const ids = [
    ...panes.map((pane) => pane.id),
    ...panes.flatMap((pane) => pane.tabs.map((tab) => tab.id)),
  ];

  return new Set(ids).size === ids.length;
}
