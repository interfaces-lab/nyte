import { sessionScreenStyles } from "./session-screen.stylex.ts";
import { props } from "@stylexjs/stylex";
import { useLayoutEffect, useRef } from "react";
import type { PointerEvent, ReactElement, RefObject } from "react";
import { usePaneActions } from "../layout/pane-context.tsx";
import { clampSplitRatio, clampSplitRatioForSize } from "../layout/pane-layout.ts";
import type { PaneLayout, SplitDirection } from "../layout/pane-layout.ts";

/** The split as shown at `width`: the stored ratio stays put so it returns when the window grows. */
export function fitSplitRatio(layout: PaneLayout, width: number): PaneLayout {
  if (layout.kind !== "split") return layout;

  const ratio =
    layout.direction === "right"
      ? clampSplitRatioForSize(layout.ratio, width)
      : clampSplitRatio(layout.ratio);

  return ratio === layout.ratio ? layout : { ...layout, ratio };
}

export function SplitSash({
  direction,
  ratio,
  dragRatio,
  onDragRatio,
  availableWidth,
  onAvailableWidth,
  containerRef,
}: {
  direction: SplitDirection;
  ratio: number;
  dragRatio: number | undefined;
  onDragRatio: (ratio: number | undefined) => void;
  availableWidth: number;
  onAvailableWidth: (width: number) => void;
  containerRef: RefObject<HTMLDivElement | null>;
}): ReactElement {
  const actions = usePaneActions();
  const sashRef = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- observes the split's size before paint, rebound per direction
  useLayoutEffect(() => {
    const container = containerRef.current;
    const sash = sashRef.current;

    if (container === null || sash === null) return;

    const measure = (): void => {
      onAvailableWidth(
        container.getBoundingClientRect().width -
          (direction === "right" ? sash.getBoundingClientRect().width : 0),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(sash);

    return () => observer.disconnect();
  }, [containerRef, direction, onAvailableWidth]);

  const clampRatio = (nextRatio: number, width: number): number =>
    direction === "right" ? clampSplitRatioForSize(nextRatio, width) : clampSplitRatio(nextRatio);

  const ratioFromPointer = (event: PointerEvent<HTMLDivElement>): number | undefined => {
    const container = containerRef.current;

    if (container === null) return undefined;
    const bounds = container.getBoundingClientRect();
    const lane = event.currentTarget.getBoundingClientRect();
    const laneSize = direction === "right" ? lane.width : lane.height;
    const size = (direction === "right" ? bounds.width : bounds.height) - laneSize;

    if (size <= 0) return undefined;
    const pixels = direction === "right" ? event.clientX - bounds.left : event.clientY - bounds.top;

    return clampRatio((pixels - laneSize / 2) / size, availableWidth);
  };

  return (
    <div
      ref={sashRef}
      role="separator"
      tabIndex={0}
      aria-label="Resize chat panes"
      aria-orientation={direction === "right" ? "vertical" : "horizontal"}
      aria-valuemin={Math.round(clampRatio(0, availableWidth) * 100)}
      aria-valuemax={Math.round(clampRatio(1, availableWidth) * 100)}
      aria-valuenow={Math.round((dragRatio ?? ratio) * 100)}
      {...props(
        sessionScreenStyles.sash,
        direction === "right" ? sessionScreenStyles.sashRight : sessionScreenStyles.sashDown,
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const nextRatio = ratioFromPointer(event);

        if (nextRatio === undefined) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onDragRatio(nextRatio);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const nextRatio = ratioFromPointer(event);

        if (nextRatio !== undefined) onDragRatio(nextRatio);
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const nextRatio = ratioFromPointer(event);
        event.currentTarget.releasePointerCapture(event.pointerId);
        onDragRatio(undefined);

        if (nextRatio !== undefined) actions.resize(nextRatio);
      }}
      onLostPointerCapture={() => onDragRatio(undefined)}
      onDoubleClick={() => {
        onDragRatio(undefined);
        actions.resize(0.5);
      }}
      onPointerCancel={() => onDragRatio(undefined)}
      onKeyDown={(event) => {
        const previous = direction === "right" ? "ArrowLeft" : "ArrowUp";
        const next = direction === "right" ? "ArrowRight" : "ArrowDown";

        if (
          event.key !== previous &&
          event.key !== next &&
          event.key !== "Home" &&
          event.key !== "End"
        )
          return;
        event.preventDefault();

        const nextRatio =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? 1
              : ratio + (event.key === previous ? -0.02 : 0.02);

        actions.resize(clampRatio(nextRatio, availableWidth));
      }}
    >
      <span
        {...props(
          sessionScreenStyles.sashLine,
          direction === "right"
            ? sessionScreenStyles.sashLineRight
            : sessionScreenStyles.sashLineDown,
        )}
      />
    </div>
  );
}
