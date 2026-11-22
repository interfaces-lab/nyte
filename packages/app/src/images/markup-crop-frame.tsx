import { create, props } from "@stylexjs/stylex";
import type { PointerEvent, ReactElement } from "react";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";
import { cameraMatrix } from "./markup-geometry.ts";
import type { Camera, Crop, Size } from "./markup-geometry.ts";

export const MIN_CROP = 48;

const HIT = 44;

export interface Handle {
  readonly x: -1 | 0 | 1;
  readonly y: -1 | 0 | 1;
}

const HANDLES: readonly Handle[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

const styles = create({
  grid: {
    stroke: role.contentOnInteractiveStrong,
    strokeOpacity: 0,
    pointerEvents: "none",
    transitionProperty: "stroke-opacity",
    transitionDuration: motion.durationNormal,
  },
  shown: { strokeOpacity: 0.7 },
  frame: {
    fill: "none",
    stroke: role.strokeSecondary,
    pointerEvents: "none",
    transitionProperty: "stroke",
    transitionDuration: motion.durationNormal,
  },
  framed: { stroke: role.contentPrimary },
  bracket: {
    fill: role.contentTertiary,
    pointerEvents: "none",
    transitionProperty: "fill",
    transitionDuration: motion.durationFast,
  },
  active: { fill: role.contentPrimary },
  hit: { fill: "transparent", pointerEvents: "all" },
});

export function CropFrame(input: {
  readonly rect: Rect;
  readonly active: boolean;
  readonly grid: boolean;
  readonly aspect: number | undefined;
  readonly onGrab: (handle: Handle) => (event: PointerEvent<SVGRectElement>) => void;
}): ReactElement {
  const rect = input.rect;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const arm = Math.min(18, width / 3, height / 3);
  const thick = 3;
  const bar = Math.min(18, width / 4, height / 4);

  return (
    <g>
      <path
        d={[1, 2]
          .map(
            (third) =>
              `M ${rect.left + (width * third) / 3} ${rect.top} V ${rect.bottom} M ${rect.left} ${rect.top + (height * third) / 3} H ${rect.right}`,
          )
          .join(" ")}
        strokeWidth={1}
        {...props(styles.grid, input.grid && styles.shown)}
      />
      <rect
        x={rect.left + 0.5}
        y={rect.top + 0.5}
        width={Math.max(0, width - 1)}
        height={Math.max(0, height - 1)}
        strokeWidth={1}
        {...props(styles.frame, input.active && styles.framed)}
      />
      {HANDLES.map((handle) => {
        const cx =
          handle.x === -1 ? rect.left : handle.x === 1 ? rect.right : (rect.left + rect.right) / 2;

        const cy =
          handle.y === -1 ? rect.top : handle.y === 1 ? rect.bottom : (rect.top + rect.bottom) / 2;

        const isCorner = handle.x !== 0 && handle.y !== 0;

        if (!isCorner && input.aspect !== undefined) return null;

        const marks = isCorner
          ? `${bracket(cx + handle.x * thick, cy, cx - handle.x * arm, cy + handle.y * thick)} ${bracket(cx, cy + handle.y * thick, cx + handle.x * thick, cy - handle.y * arm)}`
          : handle.x === 0
            ? bracket(cx - bar / 2, cy, cx + bar / 2, cy + handle.y * thick)
            : bracket(cx, cy - bar / 2, cx + handle.x * thick, cy + bar / 2);

        const hitWidth = isCorner ? HIT : handle.x === 0 ? Math.max(0, width - HIT) : HIT;
        const hitHeight = isCorner ? HIT : handle.y === 0 ? Math.max(0, height - HIT) : HIT;
        const outward = { x: (handle.x * HIT) / 4, y: (handle.y * HIT) / 4 };

        return (
          <g key={`${handle.x}${handle.y}`}>
            <path d={marks} {...props(styles.bracket, input.active && styles.active)} />
            <rect
              x={cx + outward.x - hitWidth / 2}
              y={cy + outward.y - hitHeight / 2}
              width={hitWidth}
              height={hitHeight}
              style={{ cursor: cursorFor(handle) }}
              onPointerDown={input.onGrab(handle)}
              {...props(styles.hit)}
            />
          </g>
        );
      })}
    </g>
  );
}

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function cropRect(crop: Crop, camera: Camera, viewport: Size): Rect {
  const center = cameraMatrix(viewport, camera).transformPoint({ x: crop.cx, y: crop.cy });
  const halfW = (crop.w * camera.scale * Math.abs(camera.squash)) / 2;
  const halfH = (crop.h * camera.scale) / 2;

  return {
    left: center.x - halfW,
    top: center.y - halfH,
    right: center.x + halfW,
    bottom: center.y + halfH,
  };
}

export function rectCrop(rect: Rect, camera: Camera, viewport: Size): Crop {
  const center = cameraMatrix(viewport, camera)
    .inverse()
    .transformPoint({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });

  return {
    cx: center.x,
    cy: center.y,
    w: (rect.right - rect.left) / camera.scale,
    h: (rect.bottom - rect.top) / camera.scale,
  };
}

export function resizeRect(
  rect: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  aspect: number | undefined,
): Rect {
  const left = handle.x === -1 ? Math.min(rect.left + dx, rect.right - MIN_CROP) : rect.left;
  const right = handle.x === 1 ? Math.max(rect.right + dx, rect.left + MIN_CROP) : rect.right;
  const top = handle.y === -1 ? Math.min(rect.top + dy, rect.bottom - MIN_CROP) : rect.top;
  const bottom = handle.y === 1 ? Math.max(rect.bottom + dy, rect.top + MIN_CROP) : rect.bottom;

  if (aspect === undefined || handle.x === 0 || handle.y === 0) return { left, top, right, bottom };

  const ratio = (rect.right - rect.left) / (rect.bottom - rect.top);

  const wide =
    (right - left) / (rect.right - rect.left) > (bottom - top) / (rect.bottom - rect.top);

  const width = wide ? right - left : (bottom - top) * ratio;
  const height = wide ? (right - left) / ratio : bottom - top;

  return {
    left: handle.x === -1 ? rect.right - width : rect.left,
    right: handle.x === 1 ? rect.left + width : rect.right,
    top: handle.y === -1 ? rect.bottom - height : rect.top,
    bottom: handle.y === 1 ? rect.top + height : rect.bottom,
  };
}

export function mixRect(from: Rect, to: Rect, t: number): Rect {
  return {
    left: from.left + (to.left - from.left) * t,
    top: from.top + (to.top - from.top) * t,
    right: from.right + (to.right - from.right) * t,
    bottom: from.bottom + (to.bottom - from.bottom) * t,
  };
}

function bracket(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${Math.min(x1, x2)} ${Math.min(y1, y2)} H ${Math.max(x1, x2)} V ${Math.max(y1, y2)} H ${Math.min(x1, x2)} Z`;
}

export function roundedRect(rect: Rect, radius: number): string {
  const r = Math.min(radius, (rect.right - rect.left) / 2, (rect.bottom - rect.top) / 2);

  return (
    `M ${rect.left + r} ${rect.top} H ${rect.right - r} A ${r} ${r} 0 0 1 ${rect.right} ${rect.top + r} ` +
    `V ${rect.bottom - r} A ${r} ${r} 0 0 1 ${rect.right - r} ${rect.bottom} H ${rect.left + r} ` +
    `A ${r} ${r} 0 0 1 ${rect.left} ${rect.bottom - r} V ${rect.top + r} A ${r} ${r} 0 0 1 ${rect.left + r} ${rect.top} Z`
  );
}

function cursorFor(handle: Handle): string {
  if (handle.x === 0) return "ns-resize";

  if (handle.y === 0) return "ew-resize";

  return handle.x === handle.y ? "nwse-resize" : "nesw-resize";
}
