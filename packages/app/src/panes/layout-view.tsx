import { props } from "@stylexjs/stylex";
import { useState, useSyncExternalStore } from "react";
import type { PointerEvent, ReactElement, ReactNode } from "react";
import { sessionScreenStyles } from "./session-screen.stylex.ts";
import { layoutPanes, reduceLayout, tabShown } from "./layout.ts";
import type { Layout, LayoutNode, PaneId, PaneSize, PaneTabId, Split } from "./layout.ts";
import type { LayoutStore } from "./layout-store.ts";
import { boxStyle, layoutGeometry } from "./pane-geometry.ts";
import type { Box, Geometry, Linear, Separator } from "./pane-geometry.ts";
import { paneMount, paneRules } from "./pane-kinds.ts";
import type { PaneContent } from "./pane-kinds.ts";
import { MIN_PANE_SIZE } from "./pane-layout.ts";
import type { PaneTabInput } from "./pane-views.tsx";

export const PANE_GAP = "var(--nyte-pane-sash-size)";

const KEY_STEP = 0.02;

interface Frame {
  readonly width: number;
  readonly height: number;
  readonly gap: number;
}

export function LayoutView({
  store,
  renderTab,
  children,
}: {
  readonly store: LayoutStore;
  readonly renderTab: (input: PaneTabInput) => ReactNode;
  readonly children?: ReactNode;
}): ReactElement {
  const layout = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const geometry = layoutGeometry(layout);
  const [frame, setFrame] = useState<Frame | undefined>();

  const observe = (root: HTMLDivElement): (() => void) => {
    const observer = new ResizeObserver(() => setFrame(readFrame(root)));

    observer.observe(root);

    return () => observer.disconnect();
  };

  const tabs = layoutPanes(layout.root).flatMap((pane) =>
    pane.tabs.flatMap((tab) => {
      const box = geometry.panes.get(pane.id);

      return box === undefined ||
        (paneMount(tab.content) === "while-active" && tab.id !== pane.active)
        ? []
        : [{ pane: pane.id, tab: tab.id, content: tab.content, box }];
    }),
  );

  return (
    <div ref={observe} {...props(sessionScreenStyles.layout)}>
      {tabs.map((entry) => (
        <LayoutTab
          key={entry.tab}
          store={store}
          pane={entry.pane}
          tab={entry.tab}
          content={entry.content}
          box={entry.box}
          visible={tabShown(layout, entry.tab)}
          focused={layout.focus[0] === entry.pane}
          zoomed={layout.zoomed === entry.pane}
          renderTab={renderTab}
        />
      ))}
      {layout.zoomed === null &&
        geometry.separators.map((separator) => (
          <LayoutSeparator
            key={separatorKey(separator)}
            store={store}
            layout={layout}
            geometry={geometry}
            separator={separator}
            frame={frame}
          />
        ))}
      {children}
    </div>
  );
}

function LayoutTab({
  store,
  pane,
  tab,
  content,
  box,
  visible,
  focused,
  zoomed,
  renderTab,
}: {
  readonly store: LayoutStore;
  readonly pane: PaneId;
  readonly tab: PaneTabId;
  readonly content: PaneContent;
  readonly box: Box;
  readonly visible: boolean;
  readonly focused: boolean;
  readonly zoomed: boolean;
  readonly renderTab: (input: PaneTabInput) => ReactNode;
}): ReactElement {
  const focus = (): void => {
    if (store.getSnapshot().focus[0] === pane) return;
    store.dispatch({ kind: "focus", pane });
    store.requestFocus(pane);
  };

  return (
    <div
      data-nyte-pane-id={pane}
      data-nyte-pane-tab={tab}
      inert={visible ? undefined : true}
      {...props(
        sessionScreenStyles.layoutTab,
        !visible && sessionScreenStyles.layoutTabHidden,
        zoomed && sessionScreenStyles.layoutTabZoomed,
      )}
      style={boxStyle(box, PANE_GAP)}
      onPointerDown={focus}
      onFocusCapture={focus}
    >
      {renderTab({ tab, pane, content, visible, focused })}
    </div>
  );
}

function LayoutSeparator({
  store,
  layout,
  geometry,
  separator,
  frame,
}: {
  readonly store: LayoutStore;
  readonly layout: Layout<PaneContent>;
  readonly geometry: Geometry;
  readonly separator: Separator;
  readonly frame: Frame | undefined;
}): ReactElement {
  const across = separator.direction === "right";
  const value = separatorValue(layout, separator, geometry, frame);

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
      (span) => pointer - measured.gap / 2 - span.start,
    );
  };

  const paint = (element: HTMLElement, next: Layout<PaneContent>): void => {
    const root = element.parentElement;

    if (root === null) return;
    const drawn = layoutGeometry(next);

    for (const child of root.children) {
      if (!(child instanceof HTMLElement)) continue;
      const paneId = child.getAttribute("data-nyte-pane-id");
      const separatorId = child.getAttribute("data-nyte-separator");
      const paneBox = [...drawn.panes].find(([id]) => id === paneId)?.[1];
      const drawnSeparator = drawn.separators.find((entry) => separatorKey(entry) === separatorId);
      const box = paneBox ?? drawnSeparator?.box;

      if (box !== undefined) paintBox(child, box);
    }

    const now = separatorValue(next, separator, drawn, undefined).now;
    element.setAttribute("aria-valuenow", String(now));
  };

  const preview = (event: PointerEvent<HTMLDivElement>): readonly PaneSize[] | undefined => {
    const sizes = dragSizes(event);

    if (sizes !== undefined)
      paint(
        event.currentTarget,
        reduceLayout(layout, { kind: "resize", split: separator.split, sizes }, paneRules),
      );

    return sizes;
  };

  const restore = (element: HTMLElement): void => paint(element, store.getSnapshot());

  const step = (element: HTMLElement, key: string): readonly PaneSize[] | undefined => {
    const previous = across ? "ArrowLeft" : "ArrowUp";
    const next = across ? "ArrowRight" : "ArrowDown";
    const root = element.parentElement;

    if (root === null) return undefined;
    const measured = readFrame(root);

    if (key === "Home") return sizesAt(layout, separator, geometry, measured, () => 0);

    if (key === "End")
      return sizesAt(layout, separator, geometry, measured, () => Number.POSITIVE_INFINITY);

    if (key !== previous && key !== next) return undefined;
    const delta = key === previous ? -KEY_STEP : KEY_STEP;

    return sizesAt(
      layout,
      separator,
      geometry,
      measured,
      (span, total) => span.length + delta * total,
    );
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
      style={boxStyle(separator.box, PANE_GAP)}
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

        if (split !== undefined)
          resize(
            split.children.map((child) =>
              child.size.kind === "share" ? { kind: "share", share: 1 } : child.size,
            ),
          );
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
}

interface Measured {
  readonly split: Split<PaneContent>;
  readonly spans: ReadonlyMap<number, Span>;
  readonly before: number;
  readonly after: number;
}

function sizesAt(
  layout: Layout<PaneContent>,
  separator: Separator,
  geometry: Geometry,
  frame: Frame,
  length: (span: Span, total: number) => number,
): readonly PaneSize[] | undefined {
  const measured = measure(layout, separator, geometry, frame);

  if (measured === undefined) return undefined;
  const first = measured.spans.get(measured.before);
  const second = measured.spans.get(measured.after);

  if (first === undefined || second === undefined) return undefined;
  const pair = first.length + second.length;
  const floor = Math.min(MIN_PANE_SIZE, pair / 2);
  const total = [...measured.spans.values()].reduce((sum, span) => sum + span.length, 0);
  const resized = Math.min(pair - floor, Math.max(floor, length(first, total)));

  const lengths = new Map(
    [...measured.spans].map(([index, span]) => [
      index,
      index === measured.before ? resized : index === measured.after ? pair - resized : span.length,
    ]),
  );

  const children = measured.split.children;

  const shared = children.reduce(
    (sum, child, index) =>
      sum + (child.size.kind === "share" && lengths.has(index) ? child.size.share : 0),
    0,
  );

  const sharedLength = children.reduce(
    (sum, child, index) => sum + (child.size.kind === "share" ? (lengths.get(index) ?? 0) : 0),
    0,
  );

  return children.map((child, index): PaneSize => {
    const next = lengths.get(index);

    if (next === undefined) return child.size;

    if (child.size.kind === "pixels") return { kind: "pixels", pixels: next };

    return {
      kind: "share",
      share: sharedLength === 0 ? child.size.share : (next / sharedLength) * shared,
    };
  });
}

function measure(
  layout: Layout<PaneContent>,
  separator: Separator,
  geometry: Geometry,
  frame: Frame,
): Measured | undefined {
  const split = findSplit(layout.root, separator.split);

  if (split === undefined) return undefined;
  const across = separator.direction === "right";
  const size = across ? frame.width : frame.height;

  const spans = new Map(
    split.children.flatMap((child, index) => {
      const span = nodeSpan(child.node, geometry, across, size, frame.gap);

      return span === undefined ? [] : [[index, span] as const];
    }),
  );

  const after = [...spans.keys()].find((index) => index > separator.index);

  return after === undefined ? undefined : { split, spans, before: separator.index, after };
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
): SeparatorValue {
  const split = findSplit(layout.root, separator.split);

  const shown = split?.children.filter(
    (child) => !(child.node.kind === "pane" && child.node.hidden),
  );

  const shares = (shown ?? []).reduce(
    (sum, child) => sum + (child.size.kind === "share" ? child.size.share : 0),
    0,
  );

  const leading = (split?.children.slice(0, separator.index + 1) ?? [])
    .filter((child) => shown?.includes(child) === true)
    .reduce((sum, child) => sum + (child.size.kind === "share" ? child.size.share : 0), 0);

  const now = shares === 0 ? 50 : Math.round((leading / shares) * 100);
  const measured = frame === undefined ? undefined : measure(layout, separator, geometry, frame);

  if (measured === undefined) return { now, min: 0, max: 100 };
  const lengths = [...measured.spans.values()];
  const total = lengths.reduce((sum, span) => sum + span.length, 0);

  const before = [...measured.spans]
    .filter(([index]) => index < measured.before)
    .reduce((sum, [, span]) => sum + span.length, 0);

  const pair =
    (measured.spans.get(measured.before)?.length ?? 0) +
    (measured.spans.get(measured.after)?.length ?? 0);

  const floor = Math.min(MIN_PANE_SIZE, pair / 2);

  return total === 0
    ? { now, min: 0, max: 100 }
    : {
        now,
        min: Math.round(((before + floor) / total) * 100),
        max: Math.round(((before + pair - floor) / total) * 100),
      };
}

function nodeSpan(
  node: LayoutNode<PaneContent>,
  geometry: Geometry,
  across: boolean,
  size: number,
  gap: number,
): Span | undefined {
  const edges = layoutPanes(node)
    .filter((pane) => !pane.hidden)
    .flatMap((pane) => {
      const box = geometry.panes.get(pane.id);

      if (box === undefined) return [];
      const start = resolve(across ? box.x : box.y, size, gap);

      return [{ start, end: start + resolve(across ? box.width : box.height, size, gap) }];
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

function resolve(value: Linear, extent: number, gap: number): number {
  return value.px + value.fraction * extent + value.gaps * gap;
}

function paintBox(element: HTMLElement, box: Box): void {
  Object.assign(element.style, boxStyle(box, PANE_GAP));
}

function separatorKey(separator: Separator): string {
  return `${separator.split}:${String(separator.index)}`;
}
