import type { SnapBox, SnapText, Snapshot } from "./collect.ts";
import { SCALE } from "./rules.ts";

/** One length that moves an edge or makes a size, from the region's edge inwards to the element. */
export type Part =
  | {
      readonly kind: "declared";
      readonly box: number;
      readonly property: string;
      readonly px: number;
    }
  /** A size no rule sets: text, or children. */
  | { readonly kind: "content"; readonly box: number; readonly px: number }
  | { readonly kind: "layout"; readonly box: number; readonly px: number };

/** A snapshot's boxes with each one's children, for walking the layout up and down. */
export interface Tree {
  readonly boxes: readonly SnapBox[];
  readonly texts: readonly SnapText[];
  readonly children: ReadonlyMap<number, readonly SnapBox[]>;
}

export const EPSILON = 0.01;

export const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPSILON;

export const whole = (value: number): boolean => near(value, Math.round(value));

export const even = (value: number): boolean =>
  whole(value) && Math.round(value) % SCALE.grid === 0;

export function boxTree(snapshot: Snapshot): Tree {
  const children = new Map<number, SnapBox[]>();

  for (const box of snapshot.boxes) {
    if (box.parent === null) continue;
    const list = children.get(box.parent) ?? [];
    list.push(box);
    children.set(box.parent, list);
  }

  return { boxes: snapshot.boxes, texts: snapshot.texts, children };
}

export function heightParts(tree: Tree, box: SnapBox): Part[] {
  const own = ["padding-top", "padding-bottom", "border-top-width", "border-bottom-width"].map(
    (property): Part => ({
      kind: "declared",
      box: box.id,
      property,
      px: box.lengths[property] ?? 0,
    }),
  );

  const line =
    box.font.lineHeight !== null && tree.texts.some((text) => text.box === box.id)
      ? [
          {
            kind: "declared" as const,
            box: box.id,
            property: "line-height",
            px: box.font.lineHeight,
          },
        ]
      : [];

  const kids = flowChildren(tree, box).map((child): Part =>
    child.lengths.height === undefined
      ? { kind: "content", box: child.id, px: child.rect.height }
      : { kind: "declared", box: child.id, property: "height", px: child.rect.height },
  );

  return [...own, ...line, ...kids].filter((part) => part.px !== 0);
}

export function flowChildren(tree: Tree, box: SnapBox): SnapBox[] {
  return (tree.children.get(box.id) ?? []).filter(
    (child) => !child.outOfFlow && !child.font.inline,
  );
}

export function heightOrigin(tree: Tree, box: SnapBox): SnapBox {
  const child = flowChildren(tree, box).find((entry) => !even(entry.rect.height));

  return child === undefined || child.lengths.height !== undefined
    ? box
    : heightOrigin(tree, child);
}

export function descends(tree: Tree, id: number, ancestor: number): boolean {
  for (
    let current: number | null = id;
    current !== null;
    current = tree.boxes[current]?.parent ?? null
  )
    if (current === ancestor) return true;

  return false;
}

export function offsetParts(
  tree: Tree,
  box: SnapBox,
  side: "left" | "right" | "top",
  stop: number | null,
  text = false,
): Part[] {
  const parts: Part[] = [];

  if (text) {
    for (const property of [`padding-${side}`, `border-${side}-width`])
      if ((box.lengths[property] ?? 0) !== 0)
        parts.push({ kind: "declared", box: box.id, property, px: box.lengths[property] ?? 0 });
  }

  for (let child = box; child.parent !== null && child.id !== stop;) {
    const parent = tree.boxes[child.parent];

    if (parent === undefined) break;

    const edge = (entry: SnapBox): number =>
      side === "left"
        ? entry.rect.left
        : side === "top"
          ? entry.rect.top
          : -(entry.rect.left + entry.rect.width);

    const delta = edge(child) - edge(parent);

    const step: Part[] = [
      {
        kind: "declared",
        box: parent.id,
        property: `padding-${side}`,
        px: parent.lengths[`padding-${side}`] ?? 0,
      },
      {
        kind: "declared",
        box: parent.id,
        property: `border-${side}-width`,
        px: parent.lengths[`border-${side}-width`] ?? 0,
      },
      {
        kind: "declared",
        box: child.id,
        property: `margin-${side}`,
        px: child.lengths[`margin-${side}`] ?? 0,
      },
    ];

    const flowAxis = side === "top" ? "column" : "row";

    if (!child.outOfFlow && parent.flow === flowAxis) {
      const siblings = (tree.children.get(parent.id) ?? []).filter(
        (entry) =>
          !entry.outOfFlow && (side === "right" ? entry.id > child.id : entry.id < child.id),
      );

      const gap = flowAxis === "row" ? "column-gap" : "row-gap";

      for (const sibling of siblings) {
        const size = side === "top" ? sibling.rect.height : sibling.rect.width;
        const property = side === "top" ? "height" : "width";
        step.push(
          sibling.lengths[property] === undefined
            ? { kind: "content", box: sibling.id, px: size }
            : { kind: "declared", box: sibling.id, property, px: size },
        );
      }

      if (siblings.length > 0)
        step.push({
          kind: "declared",
          box: parent.id,
          property: gap,
          px: (parent.lengths[gap] ?? 0) * siblings.length,
        });
    }

    const explained = step.reduce((total, part) => total + part.px, 0);
    const residual = Math.round((delta - explained) * 100) / 100;
    parts.push(...step.filter((part) => part.px !== 0));

    if (Math.abs(residual) > EPSILON) parts.push({ kind: "layout", box: parent.id, px: residual });
    child = parent;

    if (stop === null) break;
  }

  return parts;
}

export function stepParts(tree: Tree, previous: SnapBox, row: SnapBox): Part[] {
  const parts: Part[] = [
    { kind: "declared", box: previous.id, property: "height", px: previous.rect.height },
  ];

  const parent = row.parent === null ? undefined : tree.boxes[row.parent];

  if (parent !== undefined && previous.parent === row.parent)
    parts.push({
      kind: "declared",
      box: parent.id,
      property: "row-gap",
      px: parent.lengths["row-gap"] ?? 0,
    });

  return parts.filter((part) => part.px !== 0);
}
