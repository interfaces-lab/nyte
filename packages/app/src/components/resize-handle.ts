import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

/**
 * A panel edge the user drags to set a width.
 * - grow: which way the pointer moves to widen the panel.
 * - preview: shows a width while dragging, without storing it.
 * - commit: stores a width the drag or the keyboard settled on.
 * - restore: puts back the stored width after a cancelled drag.
 * - reset: double-click's width, when the panel has one.
 */
export interface ResizeEdge {
  readonly width: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly grow: "left" | "right";
  readonly preview: (width: number) => void;
  readonly commit: (width: number) => void;
  readonly restore: () => void;
  readonly reset?: () => void;
}

interface Drag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  next: number;
  readonly stop: () => void;
}

/**
 * Pointer, keyboard and ARIA wiring for a separator that resizes `edge`. Spread `props` on the
 * separator; `resizing` is true while a drag is in progress. Escape or a cancelled pointer puts
 * the stored width back.
 */
export function useResizeHandle(edge: ResizeEdge) {
  const [resizing, setResizing] = useState(false);
  const drag = useRef<Drag | undefined>(undefined);

  const clamp = (width: number): number =>
    Math.min(edge.max, Math.max(edge.min, Math.round(width)));

  const finish = (): Drag | undefined => {
    const current = drag.current;

    drag.current = undefined;
    current?.stop();
    setResizing(false);

    return current;
  };

  const cancel = (): void => {
    if (finish() !== undefined) edge.restore();
  };

  const props = {
    tabIndex: 0,
    "aria-valuemin": edge.min,
    "aria-valuemax": edge.max,
    "aria-valuenow": edge.width,
    onPointerDown: (event: PointerEvent<HTMLElement>): void => {
      if (event.button !== 0 || drag.current !== undefined) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);

      const escape = (key: globalThis.KeyboardEvent): void => {
        if (key.key !== "Escape") return;
        key.preventDefault();
        key.stopPropagation();
        cancel();
      };

      window.addEventListener("keydown", escape, true);
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: edge.width,
        next: edge.width,
        stop: () => window.removeEventListener("keydown", escape, true),
      };
      setResizing(true);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>): void => {
      const current = drag.current;

      if (current === undefined || current.pointerId !== event.pointerId) return;
      const moved = event.clientX - current.startX;
      current.next = clamp(current.startWidth + (edge.grow === "right" ? moved : -moved));
      edge.preview(current.next);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>): void => {
      if (drag.current?.pointerId !== event.pointerId) return;
      const current = finish();

      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);

      if (current !== undefined) edge.commit(current.next);
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>): void => {
      if (drag.current?.pointerId === event.pointerId) cancel();
    },
    onLostPointerCapture: (event: PointerEvent<HTMLElement>): void => {
      if (drag.current?.pointerId === event.pointerId) cancel();
    },
    onDoubleClick: edge.reset,
    onKeyDown: (event: KeyboardEvent<HTMLElement>): void => {
      const step = event.shiftKey ? edge.step * 4 : edge.step;
      const wider = edge.grow === "right" ? "ArrowRight" : "ArrowLeft";
      const narrower = edge.grow === "right" ? "ArrowLeft" : "ArrowRight";

      const width =
        event.key === wider
          ? edge.width + step
          : event.key === narrower
            ? edge.width - step
            : event.key === "Home"
              ? edge.min
              : event.key === "End"
                ? edge.max
                : undefined;

      if (width === undefined) return;
      event.preventDefault();
      edge.commit(clamp(width));
    },
  };

  return { resizing, props };
}
