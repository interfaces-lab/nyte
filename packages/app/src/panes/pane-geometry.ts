import type { CSSProperties } from "react";
import { divide } from "./divide.ts";
import { sizeWeight } from "./layout.ts";
import type { Layout, LayoutNode, PaneId, SplitDirection, SplitId, TabContent } from "./layout.ts";
import { add, CONTAINER, compose, constant, piecewiseCss, scale } from "./piecewise.ts";
import type { Piecewise } from "./piecewise.ts";

export interface PaneMetrics {
  readonly gap: number;
  readonly minimum: number;
}

export interface Box {
  readonly x: Piecewise;
  readonly y: Piecewise;
  readonly width: Piecewise;
  readonly height: Piecewise;
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

const WHOLE: Box = { x: constant(0), y: constant(0), width: CONTAINER, height: CONTAINER };

export function layoutGeometry<Content extends TabContent>(
  layout: Layout<Content>,
  metrics: PaneMetrics,
): Geometry {
  const placed = place(layout.root, WHOLE, metrics);

  return { panes: new Map(placed.panes), separators: placed.separators };
}

/** The smallest length a node takes along a direction before its panes go below their minimum. */
export function minimumLength<Content extends TabContent>(
  node: LayoutNode<Content>,
  direction: SplitDirection,
  metrics: PaneMetrics,
): number {
  if (node.kind === "pane") return metrics.minimum;
  const lengths = node.children.map((child) => minimumLength(child.node, direction, metrics));

  if (node.direction !== direction) return Math.max(...lengths);

  return (
    lengths.reduce((sum, length) => sum + length, 0) + (node.children.length - 1) * metrics.gap
  );
}

export function boxStyle(
  box: Box,
): Required<
  Pick<CSSProperties, "insetInlineStart" | "insetBlockStart" | "inlineSize" | "blockSize">
> {
  const inline = snappedSpan(box.x, box.width, "100cqi");
  const block = snappedSpan(box.y, box.height, "100cqb");

  return {
    insetInlineStart: inline.start,
    insetBlockStart: block.start,
    inlineSize: inline.size,
    blockSize: block.size,
  };
}

function snappedSpan(start: Piecewise, length: Piecewise, extent: string) {
  const from = `round(${piecewiseCss(start, extent)}, 1px)`;
  const to = `round(${piecewiseCss(add(start, length), extent)}, 1px)`;

  return { start: from, size: `calc(${to} - ${from})` };
}

function place<Content extends TabContent>(
  node: LayoutNode<Content>,
  box: Box,
  metrics: PaneMetrics,
): Placed {
  if (node.kind === "pane") return { panes: [[node.id, box]], separators: [] };
  const across = node.direction === "right";
  const start = across ? box.x : box.y;
  const extent = across ? box.width : box.height;
  const count = node.children.length - 1;
  const gap = constant(metrics.gap);
  const space = add(extent, constant(-count * metrics.gap));

  const shares = divide(
    node.children.map((child) => ({
      px: typeof child.size === "number" ? undefined : child.size.px,
      weight: sizeWeight(child.size),
      min: minimumLength(child.node, node.direction, metrics),
    })),
  );

  const lengths = shares.map((share) => compose(share, space));

  const along = (at: Piecewise, length: Piecewise): Box =>
    across ? { ...box, x: at, width: length } : { ...box, y: at, height: length };

  const laid = node.children.reduce(
    (state: { readonly offset: Piecewise; readonly placed: Placed }, child, index) => {
      const last = index === count;

      const length = last
        ? add(add(start, extent), scale(state.offset, -1))
        : (lengths[index] ?? constant(0));

      const inner = merge(state.placed, place(child.node, along(state.offset, length), metrics));
      const end = add(state.offset, length);

      if (last) return { offset: end, placed: inner };

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
