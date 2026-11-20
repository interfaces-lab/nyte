import { elementBox, overlaps } from "./picker.ts";
import type { Box, Point } from "./picker.ts";

export interface Redline {
  readonly from: Point;
  readonly to: Point;
  readonly length: number;
}

export interface Spacing {
  readonly margin: readonly Box[];
  readonly padding: readonly Box[];
  readonly gaps: readonly Box[];
}

export interface TrackMap {
  readonly containers: readonly Box[];
  readonly lines: readonly Redline[];
  readonly gaps: readonly Box[];
}

export function redlines(from: Box, to: Box): readonly Redline[] {
  if (contains(to, from)) return inset(from, to);

  if (contains(from, to)) return inset(to, from);

  const sharedY = overlap(from.y, bottom(from), to.y, bottom(to));
  const sharedX = overlap(from.x, right(from), to.x, right(to));
  const midY = sharedY === undefined ? from.y + from.height / 2 : sharedY;
  const midX = sharedX === undefined ? from.x + from.width / 2 : sharedX;

  return [
    right(from) <= to.x ? across(right(from), to.x, midY) : undefined,
    right(to) <= from.x ? across(right(to), from.x, midY) : undefined,
    bottom(from) <= to.y ? down(midX, bottom(from), to.y) : undefined,
    bottom(to) <= from.y ? down(midX, bottom(to), from.y) : undefined,
  ].filter((line): line is Redline => line !== undefined && line.length >= 1);
}

export function measureSpacing(element: Element, root: Element): Spacing {
  const box = elementBox(element, root);
  const style = getComputedStyle(element);
  const px = (value: string): number => Number.parseFloat(value) || 0;

  const border = {
    top: px(style.borderTopWidth),
    right: px(style.borderRightWidth),
    bottom: px(style.borderBottomWidth),
    left: px(style.borderLeftWidth),
  };

  const padding = {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  };

  const margin = {
    top: px(style.marginTop),
    right: px(style.marginRight),
    bottom: px(style.marginBottom),
    left: px(style.marginLeft),
  };

  const inner = {
    x: box.x + border.left,
    y: box.y + border.top,
    width: box.width - border.left - border.right,
    height: box.height - border.top - border.bottom,
  };

  return {
    margin: [
      { x: box.x, y: box.y - margin.top, width: box.width, height: margin.top },
      { x: right(box), y: box.y, width: margin.right, height: box.height },
      { x: box.x, y: bottom(box), width: box.width, height: margin.bottom },
      { x: box.x - margin.left, y: box.y, width: margin.left, height: box.height },
    ].filter(hasArea),
    padding: [
      { x: inner.x, y: inner.y, width: inner.width, height: padding.top },
      {
        x: right(inner) - padding.right,
        y: inner.y + padding.top,
        width: padding.right,
        height: inner.height - padding.top - padding.bottom,
      },
      {
        x: inner.x,
        y: bottom(inner) - padding.bottom,
        width: inner.width,
        height: padding.bottom,
      },
      {
        x: inner.x,
        y: inner.y + padding.top,
        width: padding.left,
        height: inner.height - padding.top - padding.bottom,
      },
    ].filter(hasArea),
    gaps: arrangesChildren(style.display) ? childGaps(element, root) : [],
  };
}

export function trackMap(
  elements: readonly Element[],
  root: Element,
  view: Box,
  limit: number,
): TrackMap {
  const containers: { readonly element: Element; readonly box: Box }[] = [];

  for (const element of [root, ...elements]) {
    if (containers.length === limit) break;
    const box = elementBox(element, root);

    if (
      hasArea(box) &&
      overlaps(box, view) &&
      arrangesChildren(getComputedStyle(element).display)
    ) {
      containers.push({ element, box });
    }
  }

  return {
    containers: containers.map((entry) => entry.box),
    lines: containers.flatMap((entry) => gridLines(entry.element, entry.box)),
    gaps: containers.flatMap((entry) => childGaps(entry.element, root)),
  };
}

function gridLines(element: Element, box: Box): readonly Redline[] {
  const style = getComputedStyle(element);

  if (!style.display.endsWith("grid")) return [];
  const px = (value: string): number => Number.parseFloat(value) || 0;
  const left = box.x + px(style.borderLeftWidth) + px(style.paddingLeft);
  const top = box.y + px(style.borderTopWidth) + px(style.paddingTop);
  const columns = edges(tracks(style.gridTemplateColumns), px(style.columnGap), left);
  const rows = edges(tracks(style.gridTemplateRows), px(style.rowGap), top);

  return [
    ...columns.map((x) => down(x, box.y, bottom(box))),
    ...rows.map((y) => across(box.x, right(box), y)),
  ];
}

function edges(sizes: readonly number[], gap: number, start: number): readonly number[] {
  return sizes.flatMap((size, index) => {
    const from = start + sizes.slice(0, index).reduce((sum, each) => sum + each + gap, 0);

    return [from, from + size];
  });
}

function tracks(template: string): readonly number[] {
  return template
    .split(/\s+/)
    .map((token) => Number.parseFloat(token))
    .filter((size) => Number.isFinite(size) && size > 0);
}

function childGaps(element: Element, root: Element): readonly Box[] {
  const children = [...element.children].flatMap((child) => {
    if (getComputedStyle(child).position === "absolute") return [];
    const box = elementBox(child, root);

    return hasArea(box) ? [box] : [];
  });

  return children.slice(1).flatMap((next, index): readonly Box[] => {
    const previous = children[index];

    if (previous === undefined) return [];

    if (
      next.x >= right(previous) &&
      overlap(previous.y, bottom(previous), next.y, bottom(next)) !== undefined
    ) {
      const y = Math.min(previous.y, next.y);

      return [
        {
          x: right(previous),
          y,
          width: next.x - right(previous),
          height: Math.max(bottom(previous), bottom(next)) - y,
        },
      ].filter(hasArea);
    }

    if (next.y >= bottom(previous)) {
      const x = Math.min(previous.x, next.x);

      return [
        {
          x,
          y: bottom(previous),
          width: Math.max(right(previous), right(next)) - x,
          height: next.y - bottom(previous),
        },
      ].filter(hasArea);
    }

    return [];
  });
}

function inset(inner: Box, outer: Box): readonly Redline[] {
  const midX = inner.x + inner.width / 2;
  const midY = inner.y + inner.height / 2;

  return [
    down(midX, outer.y, inner.y),
    down(midX, bottom(inner), bottom(outer)),
    across(outer.x, inner.x, midY),
    across(right(inner), right(outer), midY),
  ].filter((line) => line.length >= 1);
}

function across(fromX: number, toX: number, y: number): Redline {
  return { from: { x: fromX, y }, to: { x: toX, y }, length: toX - fromX };
}

function down(x: number, fromY: number, toY: number): Redline {
  return { from: { x, y: fromY }, to: { x, y: toY }, length: toY - fromY };
}

function overlap(
  start: number,
  end: number,
  otherStart: number,
  otherEnd: number,
): number | undefined {
  const from = Math.max(start, otherStart);
  const to = Math.min(end, otherEnd);

  return to > from ? (from + to) / 2 : undefined;
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    right(inner) <= right(outer) &&
    bottom(inner) <= bottom(outer)
  );
}

function arrangesChildren(display: string): boolean {
  return display.endsWith("flex") || display.endsWith("grid");
}

function hasArea(box: Box): boolean {
  return box.width >= 1 && box.height >= 1;
}

function right(box: Box): number {
  return box.x + box.width;
}

function bottom(box: Box): number {
  return box.y + box.height;
}
