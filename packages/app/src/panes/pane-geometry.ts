import type { CSSProperties } from "react";
import type { Layout, LayoutNode, PaneId, SplitDirection, SplitId, TabContent } from "./layout.ts";

export interface Linear {
  readonly px: number;
  readonly fraction: number;
  readonly gaps: number;
}

export interface Box {
  readonly x: Linear;
  readonly y: Linear;
  readonly width: Linear;
  readonly height: Linear;
}

export interface Separator {
  readonly split: SplitId;
  readonly index: number;
  readonly direction: SplitDirection;
  readonly box: Box;
}

export interface Geometry {
  readonly panes: ReadonlyMap<PaneId, Box>;
  readonly separators: readonly Separator[];
}

interface Placed {
  readonly panes: readonly (readonly [PaneId, Box])[];
  readonly separators: readonly Separator[];
}

const ZERO: Linear = { px: 0, fraction: 0, gaps: 0 };

const WHOLE: Box = {
  x: ZERO,
  y: ZERO,
  width: { px: 0, fraction: 1, gaps: 0 },
  height: { px: 0, fraction: 1, gaps: 0 },
};

export function layoutGeometry<Content extends TabContent>(layout: Layout<Content>): Geometry {
  const placed = place(layout.root, WHOLE);
  const panes = new Map(placed.panes);

  if (layout.zoomed !== null && panes.has(layout.zoomed)) panes.set(layout.zoomed, WHOLE);

  return { panes, separators: placed.separators };
}

export function boxStyle(
  box: Box,
  gap: string,
): Required<
  Pick<CSSProperties, "insetInlineStart" | "insetBlockStart" | "inlineSize" | "blockSize">
> {
  const inline = snappedSpan(box.x, box.width, "100cqi", gap);
  const block = snappedSpan(box.y, box.height, "100cqb", gap);

  return {
    insetInlineStart: inline.start,
    insetBlockStart: block.start,
    inlineSize: inline.size,
    blockSize: block.size,
  };
}

function snappedSpan(start: Linear, length: Linear, extent: string, gap: string) {
  const from = `round(${linearCss(start, extent, gap)}, 1px)`;
  const to = `round(${linearCss(add(start, length), extent, gap)}, 1px)`;

  return { start: from, size: `calc(${to} - ${from})` };
}

function linearCss(value: Linear, extent: string, gap: string): string {
  const terms = [
    value.px === 0 ? undefined : `${format(value.px)}px`,
    value.fraction === 0 ? undefined : `${format(value.fraction)} * ${extent}`,
    value.gaps === 0 ? undefined : `${format(value.gaps)} * ${gap}`,
  ].filter((term) => term !== undefined);

  if (terms.length === 0) return "0px";

  return value.fraction === 0 && value.gaps === 0
    ? `${format(value.px)}px`
    : `calc(${terms.join(" + ")})`;
}

function place<Content extends TabContent>(node: LayoutNode<Content>, box: Box): Placed {
  if (node.kind === "pane") return { panes: [[node.id, box]], separators: [] };
  const across = node.direction === "right";
  const start = across ? box.x : box.y;
  const extent = across ? box.width : box.height;
  const shown = node.children.filter((child) => !(child.node.kind === "pane" && child.node.hidden));

  const pixels = shown.reduce(
    (sum, child) => sum + (child.size.kind === "pixels" ? child.size.pixels : 0),
    0,
  );

  const shares = shown.reduce(
    (sum, child) => sum + (child.size.kind === "share" ? child.size.share : 0),
    0,
  );

  const free = add(extent, { px: -pixels, fraction: 0, gaps: 1 - shown.length });
  const last = shown.at(-1);
  const gap: Linear = { px: 0, fraction: 0, gaps: 1 };

  const along = (at: Linear, length: Linear): Box =>
    across ? { ...box, x: at, width: length } : { ...box, y: at, height: length };

  const laid = node.children.reduce(
    (state: { readonly offset: Linear; readonly placed: Placed }, child, index) => {
      if (!shown.includes(child))
        return {
          offset: state.offset,
          placed: merge(state.placed, place(child.node, along(state.offset, ZERO))),
        };

      const length =
        child === last
          ? subtract(add(start, extent), state.offset)
          : child.size.kind === "pixels"
            ? { px: child.size.pixels, fraction: 0, gaps: 0 }
            : scale(free, shares === 0 ? 0 : child.size.share / shares);

      const inner = merge(state.placed, place(child.node, along(state.offset, length)));
      const end = add(state.offset, length);

      if (child === last) return { offset: end, placed: inner };

      const separator: Separator = {
        split: node.id,
        index,
        direction: node.direction,
        box: along(end, gap),
      };

      return {
        offset: add(end, gap),
        placed: { panes: inner.panes, separators: [...inner.separators, separator] },
      };
    },
    { offset: start, placed: { panes: [], separators: [] } },
  );

  return laid.placed;
}

function merge(left: Placed, right: Placed): Placed {
  return {
    panes: [...left.panes, ...right.panes],
    separators: [...left.separators, ...right.separators],
  };
}

function add(left: Linear, right: Linear): Linear {
  return {
    px: left.px + right.px,
    fraction: left.fraction + right.fraction,
    gaps: left.gaps + right.gaps,
  };
}

function subtract(left: Linear, right: Linear): Linear {
  return add(left, scale(right, -1));
}

function scale(value: Linear, factor: number): Linear {
  return { px: value.px * factor, fraction: value.fraction * factor, gaps: value.gaps * factor };
}

function format(value: number): string {
  return String(Number(value.toFixed(6)));
}
