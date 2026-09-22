import type { ClientRect } from "@dnd-kit/core";
import type { DropPlacement } from "./pane-layout.ts";

export const SESSION_DRAG_ACTIVATION_DISTANCE = 8;

export interface SessionDragPoint {
  readonly x: number;
  readonly y: number;
}

/** The nearest normalized edge wins; the middle 25% is reserved for center. */
export function placementInRect(
  rect: ClientRect,
  point: SessionDragPoint,
  allowCenter: boolean,
): DropPlacement | undefined {
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  const x = (point.x - rect.left) / rect.width;
  const y = (point.y - rect.top) / rect.height;

  const distances: readonly (readonly [Exclude<DropPlacement, "center">, number])[] = [
    ["left", x],
    ["right", 1 - x],
    ["top", y],
    ["bottom", 1 - y],
  ];

  const [placement, distance] = distances.reduce((best, next) => (next[1] < best[1] ? next : best));

  return allowCenter && distance > 0.375 ? "center" : placement;
}
