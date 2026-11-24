import { props } from "@stylexjs/stylex";
import { createContext, useState, useSyncExternalStore } from "react";
import type { PointerEvent, ReactElement, ReactNode } from "react";
import { sessionScreenStyles } from "./session-screen.stylex.ts";
import { layoutPanes, reduceLayout, sizeWeight } from "./layout.ts";
import type { Layout, LayoutNode, PaneSize, Split } from "./layout.ts";
import type { LayoutStore } from "./layout-store.ts";
import { boxStyle, layoutGeometry, minimumLength } from "./pane-geometry.ts";
import type { Box, Geometry, PaneMetrics, Separator } from "./pane-geometry.ts";
import { paneRules } from "./pane-kinds.ts";
import type { PaneContent } from "./pane-kinds.ts";
import { MIN_PANE_SIZE } from "./pane-layout.ts";
import type { PaneTabInput } from "./pane-view.ts";
import { evaluate } from "./piecewise.ts";

const KEY_STEP = 0.02;

/** The geometry the layout draws, for overlays placed over its panes. */
export const PaneGeometry = createContext<Geometry>({ panes: new Map(), separators: [] });

interface Frame {
  readonly width: number;
  readonly height: number;
  readonly gap: number;
}

type RenderTab = (input: PaneTabInput) => ReactNode;

export function LayoutView({
  store,
  renderTab,
  children,
}: {
  readonly store: LayoutStore;
  readonly renderTab: RenderTab;
  readonly children?: ReactNode;
}): ReactElement {
  const layout = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [frame, setFrame] = useState<Frame | undefined>();
  const metrics: PaneMetrics = { gap: frame?.gap ?? 0, minimum: MIN_PANE_SIZE };
  const geometry = layoutGeometry(layout, metrics);

  const observe = (root: HTMLDivElement): (() => void) => {
    const update = (): void => {
      const next = readFrame(root);

      setFrame((current) =>
        current?.width === next.width && current.height === next.height && current.gap === next.gap
          ? current
          : next,
      );
    };

    update();
    const observer = new ResizeObserver(update);

    observer.observe(root);

    return () => observer.disconnect();
  };

  const tabs = layoutPanes(layout.root).flatMap((pane) => {
    const box = geometry.panes.get(pane.id);

    return box === undefined
      ? []
      : [
          {
            box,
            input: {
              pane: pane.id,
              tab: pane.tab.id,
              content: pane.tab.content,
              visible: true,
              focused: layout.focus[0] === pane.id,
            },
          },
        ];
  });

  return (
    <div ref={observe} {...props(sessionScreenStyles.layout)}>
      {tabs.map((entry) => (
        <LayoutTab
          key={entry.input.tab}
          store={store}
          input={entry.input}
          box={entry.box}
          renderTab={renderTab}
        />
      ))}
      {geometry.separators.map((separator) => (
        <LayoutSeparator
          key={separatorKey(separator)}
          store={store}
          layout={layout}
          geometry={geometry}
          separator={separator}
          frame={frame}
          metrics={metrics}
        />
      ))}
      <PaneGeometry value={geometry}>{children}</PaneGeometry>
    </div>
  );
}

function LayoutTab({
  store,
  input,
  box,
  renderTab,
}: {
  readonly store: LayoutStore;
  readonly input: PaneTabInput;
  readonly box: Box;
  readonly renderTab: RenderTab;
}): ReactElement {
  const pane = input.pane;

  const activate = (): boolean => {
    if (store.getSnapshot().focus[0] === pane) return false;
    store.dispatch({ kind: "focus", pane });

    return true;
  };

  return (
    <div
      data-nyte-pane-id={pane}
      data-nyte-pane-tab={input.tab}
      {...props(sessionScreenStyles.layoutTab)}
      style={boxStyle(box)}
      onPointerDown={() => {
        if (activate()) store.requestFocus(pane);
      }}
      onFocusCapture={() => {
        activate();
      }}
    >
      {renderTab(input)}
    </div>
  );
}

function LayoutSeparator({
  store,
  layout,
  geometry,
  separator,
  frame,
  metrics,
}: {
  readonly store: LayoutStore;
  readonly layout: Layout<PaneContent>;
  readonly geometry: Geometry;
  readonly separator: Separator;
  readonly frame: Frame | undefined;
  readonly metrics: PaneMetrics;
}): ReactElement {
  const across = separator.direction === "right";
  const value = separatorValue(layout, separator, geometry, frame, metrics);

  const resize = (sizes: readonly PaneSize[]): void =>
    store.dispatch({ kind: "resize", split: separator.split, sizes });

  const dragSizes = (event: PointerEvent<HTMLDivElement>): readonly PaneSize[] | undefined => {
    const root = event.currentTarget.parentElement;

    if (root === null) return undefined;
    const bounds = root.getBoundingClientRect();
    const measured = readFrame(root);
    const rtl = across && getComputedStyle(root).direction === "rtl";

    const pointer = across
      ? rtl
        ? bounds.right - event.clientX
        : event.clientX - bounds.left
      : event.clientY - bounds.top;

    return sizesAt(
      layout,
      separator,
      geometry,
      measured,
      metrics,
      (pair) => pointer - measured.gap / 2 - pair.before.start - pair.before.length,
    );
  };

  const paint = (element: HTMLElement, next: Layout<PaneContent>): void => {
    const root = element.parentElement;

    if (root === null) return;
    const drawn = layoutGeometry(next, metrics);

    for (const child of root.children) {
      if (!(child instanceof HTMLElement)) continue;
      const paneId = child.getAttribute("data-nyte-pane-id");
      const separatorId = child.getAttribute("data-nyte-separator");
      const paneBox = [...drawn.panes].find(([id]) => id === paneId)?.[1];
      const drawnSeparator = drawn.separators.find((entry) => separatorKey(entry) === separatorId);
      const box = paneBox ?? drawnSeparator?.box;

      if (box !== undefined) paintBox(child, box);
    }

    const now = separatorValue(next, separator, drawn, frame, metrics).now;
    element.setAttribute("aria-valuenow", String(now));
  };

  const preview = (event: PointerEvent<HTMLDivElement>): readonly PaneSize[] | undefined => {
    const sizes = dragSizes(event);

    if (sizes !== undefined) {
      paint(
        event.currentTarget,
        reduceLayout(layout, { kind: "resize", split: separator.split, sizes }, paneRules),
      );
    }

    return sizes;
  };

  const restore = (element: HTMLElement): void => paint(element, store.getSnapshot());

  const step = (element: HTMLElement, key: string): readonly PaneSize[] | undefined => {
    const previous = across ? "ArrowLeft" : "ArrowUp";
    const next = across ? "ArrowRight" : "ArrowDown";
    const root = element.parentElement;

    if (root === null) return undefined;
    const measured = readFrame(root);

    if (key === "Home") {
      return sizesAt(layout, separator, geometry, measured, metrics, (pair) =>
        Math.min(0, pair.before.min - pair.before.length),
      );
    }

    if (key === "End") {
      return sizesAt(layout, separator, geometry, measured, metrics, (pair) =>
        Math.max(0, pair.after.length - pair.after.min),
      );
    }

    if (key !== previous && key !== next) return undefined;
    const step = key === previous ? -KEY_STEP : KEY_STEP;

    return sizesAt(layout, separator, geometry, measured, metrics, (_, total) => step * total);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      data-nyte-separator={separatorKey(separator)}
      aria-label="Resize chat panes"
      aria-orientation={across ? "vertical" : "horizontal"}
      aria-valuemin={value.min}
      aria-valuemax={value.max}
      aria-valuenow={value.now}
      {...props(
        sessionScreenStyles.sash,
        across ? sessionScreenStyles.sashRight : sessionScreenStyles.sashDown,
      )}
      style={boxStyle(separator.box)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        preview(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) preview(event);
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const sizes = preview(event);
        event.currentTarget.releasePointerCapture(event.pointerId);

        if (sizes !== undefined) resize(sizes);
      }}
      onPointerCancel={(event) => restore(event.currentTarget)}
      onDoubleClick={() => {
        const split = findSplit(layout.root, separator.split);

        if (split !== undefined) {
          resize(split.children.map((child) => (typeof child.size === "number" ? 1 : child.size)));
        }
      }}
      onKeyDown={(event) => {
        const sizes = step(event.currentTarget, event.key);

        if (sizes === undefined) return;
        event.preventDefault();
        resize(sizes);
      }}
    >
      <span
        {...props(
          sessionScreenStyles.sashLine,
          across ? sessionScreenStyles.sashLineRight : sessionScreenStyles.sashLineDown,
        )}
      />
    </div>
  );
}

interface Span {
  readonly start: number;
  readonly length: number;
  readonly min: number;
}

interface Measured {
  readonly split: Split<PaneContent>;
  readonly spans: readonly Span[];
  readonly before: Span;
  readonly after: Span;
}

function sizesAt(
  layout: Layout<PaneContent>,
  separator: Separator,
  geometry: Geometry,
  frame: Frame,
  metrics: PaneMetrics,
  move: (measured: Measured, total: number) => number,
): readonly PaneSize[] | undefined {
  const measured = measure(layout, separator, geometry, frame, metrics);

  if (measured === undefined) return undefined;
  const spans = measured.spans;
  const total = spans.reduce((sum, span) => sum + span.length, 0);
  const delta = move(measured, total);
  const index = separator.index;

  const before = spans.map((_, offset) => index - offset).filter((at) => at >= 0);
  const after = spans.map((_, offset) => index + 1 + offset).filter((at) => at < spans.length);
  const shrinking = delta < 0 ? before : after;
  const growing = (delta < 0 ? after : before)[0];

  const room = (at: number): number =>
    Math.max(0, (spans[at]?.length ?? 0) - (spans[at]?.min ?? 0));

  const distance = Math.min(
    Math.abs(delta),
    shrinking.reduce((sum, at) => sum + room(at), 0),
  );

  const taken = shrinking.reduce(
    (state: { readonly left: number; readonly taken: ReadonlyMap<number, number> }, at) => {
      const take = Math.min(state.left, room(at));

      return { left: state.left - take, taken: new Map([...state.taken, [at, take]]) };
    },
    { left: distance, taken: new Map() },
  ).taken;

  const lengths = spans.map(
    (span, at) => span.length - (taken.get(at) ?? 0) + (at === growing ? distance : 0),
  );

  const children = measured.split.children;

  const weights = children.reduce((sum, child) => sum + sizeWeight(child.size), 0);

  const weightedLength = children.reduce(
    (sum, child, at) => sum + (typeof child.size === "number" ? (lengths[at] ?? 0) : 0),
    0,
  );

  return children.map((child, at): PaneSize => {
    const length = lengths[at] ?? 0;

    if (typeof child.size !== "number") return { px: length };

    return weightedLength === 0
      ? child.size
      : (Math.max(length, weightedLength * 0.001) / weightedLength) * weights;
  });
}

function measure(
  layout: Layout<PaneContent>,
  separator: Separator,
  geometry: Geometry,
  frame: Frame,
  metrics: PaneMetrics,
): Measured | undefined {
  const split = findSplit(layout.root, separator.split);

  if (split === undefined) return undefined;
  const across = separator.direction === "right";
  const size = across ? frame.width : frame.height;

  const spans = split.children.flatMap((child) => {
    const span = nodeSpan(child.node, geometry, across, size);

    return span === undefined
      ? []
      : [{ ...span, min: minimumLength(child.node, split.direction, metrics) }];
  });

  const before = spans[separator.index];
  const after = spans[separator.index + 1];

  if (spans.length !== split.children.length || before === undefined || after === undefined) {
    return undefined;
  }

  return { split, spans, before, after };
}

interface SeparatorValue {
  readonly now: number;
  readonly min: number;
  readonly max: number;
}

function separatorValue(
  layout: Layout<PaneContent>,
  separator: Separator,
  geometry: Geometry,
  frame: Frame | undefined,
  metrics: PaneMetrics,
): SeparatorValue {
  const measured =
    frame === undefined ? undefined : measure(layout, separator, geometry, frame, metrics);

  if (measured === undefined) {
    const split = findSplit(layout.root, separator.split);
    const children = split?.children ?? [];
    const weights = children.reduce((sum, child) => sum + sizeWeight(child.size), 0);

    const leading = children
      .slice(0, separator.index + 1)
      .reduce((sum, child) => sum + sizeWeight(child.size), 0);

    return { now: weights === 0 ? 50 : Math.round((leading / weights) * 100), min: 0, max: 100 };
  }

  const spans = measured.spans;
  const total = spans.reduce((sum, span) => sum + span.length, 0);

  if (total === 0) return { now: 50, min: 0, max: 100 };
  const leading = spans.slice(0, separator.index + 1);
  const trailing = spans.slice(separator.index + 1);
  const room = (span: Span): number => Math.max(0, span.length - span.min);
  const before = leading.reduce((sum, span) => sum + span.length, 0);
  const percent = (length: number): number => Math.round((length / total) * 100);

  return {
    now: percent(before),
    min: percent(before - leading.reduce((sum, span) => sum + room(span), 0)),
    max: percent(before + trailing.reduce((sum, span) => sum + room(span), 0)),
  };
}

function nodeSpan(
  node: LayoutNode<PaneContent>,
  geometry: Geometry,
  across: boolean,
  size: number,
): { readonly start: number; readonly length: number } | undefined {
  const edges = layoutPanes(node).flatMap((pane) => {
    const box = geometry.panes.get(pane.id);

    if (box === undefined) return [];
    const start = evaluate(across ? box.x : box.y, size);

    return [{ start, end: start + evaluate(across ? box.width : box.height, size) }];
  });

  if (edges.length === 0) return undefined;
  const start = Math.min(...edges.map((edge) => edge.start));

  return { start, length: Math.max(...edges.map((edge) => edge.end)) - start };
}

function findSplit(
  node: LayoutNode<PaneContent>,
  id: Separator["split"],
): Split<PaneContent> | undefined {
  if (node.kind === "pane") return undefined;

  if (node.id === id) return node;

  return node.children
    .map((child) => findSplit(child.node, id))
    .find((split) => split !== undefined);
}

function readFrame(root: HTMLElement): Frame {
  const rect = root.getBoundingClientRect();
  const gap = Number.parseFloat(getComputedStyle(root).getPropertyValue("--nyte-pane-sash-size"));

  return { width: rect.width, height: rect.height, gap: Number.isFinite(gap) ? gap : 0 };
}

function paintBox(element: HTMLElement, box: Box): void {
  Object.assign(element.style, boxStyle(box));
}

function separatorKey(separator: Separator): string {
  return `${separator.split}:${String(separator.index)}`;
}
