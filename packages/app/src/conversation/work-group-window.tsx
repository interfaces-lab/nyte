import { props } from "@stylexjs/stylex";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { VirtualItem } from "@tanstack/react-virtual";
import { toolGroupStyles, WORK_PREVIEW_HEIGHT } from "./styles.stylex.ts";
import type { WorkGroupEntries } from "./work-group-entries.ts";
import type { ToolCallDensity } from "../theme/boot.ts";

const ROW_ESTIMATE = 24;

/**
 * Measured heights outlive the transcript unmounting a group that scrolled out
 * of view. Nothing here knows which session a group belongs to, so the cache is
 * process-wide: it keeps only the most recently measured groups, and a restore
 * is accepted only when the snapshot names the rows the group actually holds.
 */
const MAX_CACHED_GROUPS = 64;

const measurements = new Map<string, VirtualItem[]>();

function rememberMeasurements(cacheKey: string, snapshot: VirtualItem[]): void {
  // Re-inserting moves the group to the newest end of the Map's insertion order.
  measurements.delete(cacheKey);
  measurements.set(cacheKey, snapshot);

  for (const oldest of measurements.keys()) {
    if (measurements.size <= MAX_CACHED_GROUPS) break;
    measurements.delete(oldest);
  }
}

export function workGroupScrollport(viewport: HTMLElement): HTMLElement {
  const outer = viewport.parentElement?.closest("[data-nyte-scrollport]");

  return outer instanceof HTMLElement ? outer : viewport;
}

/**
 * Ignore controls, open tool bodies, and a text selection that touches the
 * preview: reading or selecting inside it must not also open the group.
 */
export function opensWorkGroup(
  target: EventTarget | null,
  selection: Selection | null,
  viewport: Element,
): boolean {
  if (selection !== null && !selection.isCollapsed) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      if (selection.getRangeAt(index).intersectsNode(viewport)) return false;
    }
  }

  return (
    target instanceof Element &&
    target.closest(
      "button, a, input, textarea, select, summary, [role=button], [contenteditable], [data-tool-body]",
    ) === null
  );
}

/**
 * Both scrollports report coordinates relative to the same plane. Changing modes
 * therefore keeps the virtualizer's measurements and the visible keyed rows.
 */
export function WorkGroupWindow<Entry extends { readonly key: string }>({
  groupKey,
  density,
  entries,
  viewportRef,
  preview,
  renderEntry,
}: {
  groupKey: string | undefined;
  density: ToolCallDensity;
  entries: WorkGroupEntries<Entry>;
  viewportRef: RefObject<HTMLDivElement | null>;
  preview: boolean;
  renderEntry: (entry: Entry) => ReactNode;
}) {
  const planeRef = useRef<HTMLDivElement>(null);
  // Heights measured under another density describe different rows. A blank
  // group key names no group: a provider can report a tool call with an empty id.
  const cacheKey = groupKey === undefined || groupKey === "" ? undefined : `${density}:${groupKey}`;

  const [restore] = useState(() => {
    const snapshot = cacheKey === undefined ? undefined : measurements.get(cacheKey);

    // Row keys are the virtualizer's identity. A snapshot that names rows this
    // group does not hold was measured by another group under a colliding key,
    // since group keys come from provider call ids that repeat across chats.
    const cached =
      snapshot !== undefined &&
      snapshot.every(
        (item) => item.index >= entries.count || item.key === entries.keyAt(item.index),
      )
        ? snapshot
        : [];

    const sizes = new Map(cached.map((item) => [item.key, item.size]));
    let total = 0;

    for (let index = 0; index < entries.count; index += 1) {
      total += sizes.get(entries.keyAt(index)) ?? ROW_ESTIMATE;
    }

    return { cached, offset: preview ? Math.max(0, total - WORK_PREVIEW_HEIGHT) : 0 };
  });

  const [bridge] = useState<{
    preview: boolean;
    viewport: HTMLDivElement | null;
    plane: HTMLDivElement | null;
    offset: number;
    previewTop: number;
    notifyOffset: (offset: number, scrolling: boolean) => void;
    notifyRect: (rect: { width: number; height: number }) => void;
  }>(() => ({
    preview,
    viewport: null,
    plane: null,
    offset: restore.offset,
    previewTop: 0,
    notifyOffset: (_offset: number, _scrolling: boolean) => {},
    notifyRect: (_rect: { width: number; height: number }) => {},
  }));

  const sync = useCallback(
    (scrolling = false) => {
      const { viewport, plane } = bridge;

      if (viewport === null || plane === null) return;
      const port = bridge.preview ? viewport : workGroupScrollport(viewport);

      const offset = bridge.preview
        ? viewport.scrollTop
        : port.getBoundingClientRect().top + port.clientTop - plane.getBoundingClientRect().top;

      if (bridge.preview) {
        const outer = workGroupScrollport(viewport);
        bridge.previewTop =
          viewport.getBoundingClientRect().top -
          outer.getBoundingClientRect().top -
          outer.clientTop;
      }

      bridge.offset = offset;
      bridge.notifyRect({ width: port.clientWidth, height: port.clientHeight });
      bridge.notifyOffset(offset, scrolling);
    },
    [bridge],
  );

  // Run before the virtualizer's layout effects. The old range remains mounted
  // while we transfer its visible position to the transcript scrollport.
  useLayoutEffect(() => {
    bridge.viewport = viewportRef.current;
    bridge.plane = planeRef.current;
    const { viewport, plane } = bridge;

    if (viewport === null || plane === null) return;

    if (bridge.preview !== preview) {
      if (!preview) {
        const outer = workGroupScrollport(viewport);
        viewport.scrollTop = 0;

        const top =
          plane.getBoundingClientRect().top - outer.getBoundingClientRect().top - outer.clientTop;

        outer.scrollTop += top + bridge.offset - bridge.previewTop;
      } else {
        const outer = workGroupScrollport(viewport);

        const top =
          viewport.getBoundingClientRect().top -
          outer.getBoundingClientRect().top -
          outer.clientTop;

        outer.scrollTop += top - bridge.previewTop;
        viewport.scrollTop = viewport.scrollHeight;
      }

      bridge.preview = preview;
    }

    sync();
  });

  // oxlint-disable-next-line react/incompatible-library -- the mutable instance stays local
  const virtualizer = useVirtualizer({
    count: entries.count,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_ESTIMATE,
    initialMeasurementsCache: restore.cached,
    initialRect: { width: 0, height: WORK_PREVIEW_HEIGHT },
    initialOffset: restore.offset,
    overscan: 6,
    getItemKey: entries.keyAt,
    observeElementRect: (_instance, notify) => {
      bridge.notifyRect = notify;
      sync();

      return () => {
        bridge.notifyRect = () => {};
      };
    },
    observeElementOffset: (_instance, notify) => {
      bridge.notifyOffset = notify;
      const viewport = viewportRef.current;

      if (viewport === null) return undefined;
      const outer = workGroupScrollport(viewport);
      const onScroll = () => sync(true);
      const onScrollEnd = () => sync();
      viewport.addEventListener("scroll", onScroll, { passive: true });
      outer.addEventListener("scroll", onScroll, { passive: true });
      viewport.addEventListener("scrollend", onScrollEnd);
      outer.addEventListener("scrollend", onScrollEnd);
      const observer = new ResizeObserver(() => sync());

      // Ancestor size changes can move this group without changing its own size.
      for (
        let node: HTMLElement | null = planeRef.current;
        node !== null;
        node = node.parentElement
      ) {
        observer.observe(node);

        if (node === outer) break;
      }

      sync();

      return () => {
        observer.disconnect();
        viewport.removeEventListener("scroll", onScroll);
        outer.removeEventListener("scroll", onScroll);
        viewport.removeEventListener("scrollend", onScrollEnd);
        outer.removeEventListener("scrollend", onScrollEnd);
        bridge.notifyOffset = () => {};
      };
    },
    scrollToFn: (offset, { adjustments = 0, behavior }) => {
      const { viewport, plane } = bridge;

      if (viewport === null || plane === null) return;

      if (bridge.preview) {
        viewport.scrollTo({ top: offset + adjustments, behavior });

        return;
      }

      const outer = workGroupScrollport(viewport);

      const origin =
        plane.getBoundingClientRect().top -
        outer.getBoundingClientRect().top -
        outer.clientTop +
        outer.scrollTop;

      outer.scrollTo({ top: origin + offset + adjustments, behavior });
    },
  });

  useLayoutEffect(
    () => () => {
      if (cacheKey !== undefined) rememberMeasurements(cacheKey, virtualizer.takeSnapshot());
    },
    [cacheKey, virtualizer],
  );

  return (
    <div
      ref={planeRef}
      {...props(toolGroupStyles.previewPlane)}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const entry = entries.at(item.index);

        if (entry === undefined) return null;

        return (
          <div
            key={entry.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            {...props(toolGroupStyles.previewRow)}
            style={{ transform: `translateY(${String(item.start)}px)` }}
          >
            {renderEntry(entry)}
          </div>
        );
      })}
    </div>
  );
}
