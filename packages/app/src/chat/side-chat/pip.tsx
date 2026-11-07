import { create, props } from "@stylexjs/stylex";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from "react";
import { floatingSurfaceStyles } from "@nyte-ai/ui/styles/floating-surface.stylex";
import { layer, space } from "@nyte-ai/ui/styles/schema.stylex";
import { occludes } from "../../components/overlay-occlusion.ts";
import { conversation } from "../../theme/schema.stylex.ts";

export type Corner = `${"top" | "bottom"}-${"start" | "end"}`;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export const GRIP = { "data-pip-grip": "" } as const;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Drag {
  readonly pointer: number;
  readonly origin: Point;
  readonly low: Point;
  readonly high: Point;
  followedX: number;
  followedY: number;
  readonly samples: Float64Array;
  count: number;
}

const SAMPLES = 5;

const THROW_MS = 180;

const MOVE_SLOP = 4;

const RESISTANCE = 0.3;

const SPRING: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 1 };

const INSTANT: Transition = { duration: 0 };

const FADE: Transition = { duration: 0.14, ease: "easeOut" };

const FOLD: Transition = { duration: 0.1, ease: "easeOut" };

const UNFOLD: Transition = { duration: 0.16, delay: 0.14, ease: "easeOut" };

const styles = create({
  layer: {
    position: "absolute",
    insetInline: 0,
    insetBlockStart: 0,
    insetBlockEnd: `anchor(${conversation.composerDock} top, 0px)`,
    pointerEvents: "none",
    containerType: "size",
    zIndex: layer.stickyContent,
  },
  card: {
    position: "absolute",
    display: "flex",
    maxWidth: `calc(100% - ${space.s6})`,
    maxHeight: `calc(100% - ${space.s6})`,
    overflow: "hidden",
    pointerEvents: "auto",
  },
  face: { position: "absolute", display: "flex", flexDirection: "column" },
  faceSize: (width: number, height: number) => ({
    width: `min(${String(width)}px, calc(100cqw - ${space.s6}))`,
    height: `min(${String(height)}px, calc(100cqh - ${space.s6}))`,
  }),
  pill: { display: "flex", flexShrink: 0, maxWidth: "100%" },
  "top-start": { insetBlockStart: space.s3, insetInlineStart: space.s3 },
  "top-end": { insetBlockStart: space.s3, insetInlineEnd: space.s3 },
  "bottom-start": { insetBlockEnd: space.s3, insetInlineStart: space.s3 },
  "bottom-end": { insetBlockEnd: space.s3, insetInlineEnd: space.s3 },
});

const pinned = create({
  "top-start": { insetBlockStart: 0, insetInlineStart: 0 },
  "top-end": { insetBlockStart: 0, insetInlineEnd: 0 },
  "bottom-start": { insetBlockEnd: 0, insetInlineStart: 0 },
  "bottom-end": { insetBlockEnd: 0, insetInlineEnd: 0 },
});

const settled = create({
  "top-start": { alignItems: "flex-start", justifyContent: "flex-start" },
  "top-end": { alignItems: "flex-start", justifyContent: "flex-end" },
  "bottom-start": { alignItems: "flex-end", justifyContent: "flex-start" },
  "bottom-end": { alignItems: "flex-end", justifyContent: "flex-end" },
});

export function Pip({
  label,
  size,
  folded,
  pill,
  children,
}: {
  readonly label: string;
  readonly size: Size;
  readonly folded: boolean;
  readonly pill: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  const still = useReducedMotion() === true;
  const spring = still ? INSTANT : SPRING;
  const [corner, setCorner] = useState<Corner>("bottom-end");
  const card = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const moved = useRef(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const settle = (next: Corner, velocity: Point): void => {
    const element = card.current;
    const area = element?.parentElement?.getBoundingClientRect();

    if (element == null || area === undefined) return;
    const rect = element.getBoundingClientRect();
    const anchorX = rect.left - x.get();
    const anchorY = rect.top - y.get();

    const insetX = corner.endsWith("start")
      ? anchorX - area.left
      : area.right - anchorX - rect.width;

    const insetY = corner.startsWith("top")
      ? anchorY - area.top
      : area.bottom - anchorY - rect.height;

    const nextX = next.endsWith("start") ? area.left + insetX : area.right - insetX - rect.width;

    const nextY = next.startsWith("top") ? area.top + insetY : area.bottom - insetY - rect.height;

    flushSync(() => setCorner(next));
    x.set(rect.left - nextX);
    y.set(rect.top - nextY);
    void animate(x, 0, { ...spring, velocity: velocity.x * 1000 });
    void animate(y, 0, { ...spring, velocity: velocity.y * 1000 });
  };

  const release = (event: PointerEvent<HTMLElement>): void => {
    const current = drag.current;
    const element = card.current;
    const area = element?.parentElement?.getBoundingClientRect();

    drag.current = null;

    if (current?.pointer !== event.pointerId || !moved.current) return;

    if (element == null || area === undefined) return;
    setTimeout(() => {
      moved.current = false;
    });
    const rect = element.getBoundingClientRect();
    const velocity = throwVelocity(current);
    const throwX = rect.left + rect.width / 2 + velocity.x * THROW_MS;
    const throwY = rect.top + rect.height / 2 + velocity.y * THROW_MS;

    settle(
      `${throwY < area.top + area.height / 2 ? "top" : "bottom"}-${
        throwX < area.left + area.width / 2 ? "start" : "end"
      }`,
      velocity,
    );
  };

  const look = props(
    floatingSurfaceStyles.popup,
    floatingSurfaceStyles.modalPopup,
    styles.card,
    styles[corner],
    settled[corner],
  );

  return (
    <div {...props(styles.layer)}>
      <motion.div
        ref={(element: HTMLDivElement | null) => {
          card.current = element;

          return occludes(element);
        }}
        role="dialog"
        aria-label={label}
        className={look.className}
        style={{ ...look.style, x, y }}
        initial={false}
        animate={{
          width: folded ? "auto" : size.width,
          height: folded ? "auto" : size.height,
        }}
        transition={spring}
        onPointerDown={(event) => {
          const target = event.target;
          const handle = target instanceof Element ? target.closest("[data-pip-grip]") : null;
          const element = card.current;
          const area = element?.parentElement?.getBoundingClientRect();

          if (event.button !== 0 || handle === null || element == null || area === undefined)
            return;
          const rect = element.getBoundingClientRect();

          handle.setPointerCapture(event.pointerId);
          x.stop();
          y.stop();
          moved.current = false;
          drag.current = {
            pointer: event.pointerId,
            origin: { x: event.clientX - x.get(), y: event.clientY - y.get() },
            low: { x: x.get() + area.left - rect.left, y: y.get() + area.top - rect.top },
            high: { x: x.get() + area.right - rect.right, y: y.get() + area.bottom - rect.bottom },
            followedX: x.get(),
            followedY: y.get(),
            samples: new Float64Array(SAMPLES * 3),
            count: 0,
          };
          record(drag.current, event);
        }}
        onPointerMove={(event) => {
          const current = drag.current;

          if (current?.pointer !== event.pointerId) return;
          const dx = event.clientX - current.origin.x;
          const dy = event.clientY - current.origin.y;

          if (!moved.current && Math.hypot(dx - x.get(), dy - y.get()) < MOVE_SLOP) return;

          moved.current = true;
          x.set(resist(dx - current.followedX, x.get(), current.low.x, current.high.x));
          y.set(resist(dy - current.followedY, y.get(), current.low.y, current.high.y));
          current.followedX = dx;
          current.followedY = dy;
          record(current, event);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onMouseDown={(event) => {
          if (event.target instanceof Element && event.target.closest("[data-pip-grip]") !== null)
            event.preventDefault();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          const next = cornerToward(corner, event.key);
          const target = event.target;

          if (next === null || !(target instanceof Element)) return;

          if (target.closest("[data-pip-grip]") === null || target.closest("input, textarea"))
            return;
          event.preventDefault();
          settle(next, { x: 0, y: 0 });
        }}
        onClickCapture={(event) => {
          if (!moved.current) return;
          moved.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <motion.div
          inert={folded}
          initial={false}
          animate={{ opacity: folded ? 0 : 1 }}
          transition={still ? INSTANT : folded ? FOLD : UNFOLD}
          {...props(styles.face, styles.faceSize(size.width, size.height), pinned[corner])}
        >
          {children}
        </motion.div>
        <motion.div
          inert={!folded}
          initial={false}
          animate={{ opacity: folded ? 1 : 0 }}
          transition={still ? INSTANT : FADE}
          {...props(styles.pill)}
        >
          {pill}
        </motion.div>
      </motion.div>
    </div>
  );
}

function resist(delta: number, offset: number, low: number, high: number): number {
  const next = offset + delta;
  const outside = next < low || next > high;

  return outside ? offset + delta * RESISTANCE : next;
}

function cornerToward(corner: Corner, key: string): Corner | null {
  const block = corner.startsWith("top") ? "top" : "bottom";
  const inline = corner.endsWith("start") ? "start" : "end";

  switch (key) {
    case "ArrowUp":
      return `top-${inline}`;
    case "ArrowDown":
      return `bottom-${inline}`;
    case "ArrowLeft":
      return `${block}-start`;
    case "ArrowRight":
      return `${block}-end`;
    default:
      return null;
  }
}

function record(drag: Drag, event: PointerEvent<HTMLElement>): void {
  const at = (drag.count % SAMPLES) * 3;

  drag.samples[at] = event.clientX;
  drag.samples[at + 1] = event.clientY;
  drag.samples[at + 2] = event.timeStamp;
  drag.count += 1;
}

function throwVelocity(drag: Drag): Point {
  const kept = Math.min(drag.count, SAMPLES);
  const newest = ((drag.count - 1) % SAMPLES) * 3;
  const lastX = drag.samples[newest] ?? 0;
  const lastY = drag.samples[newest + 1] ?? 0;
  const lastAt = drag.samples[newest + 2] ?? 0;
  let oldest = newest;

  for (let back = 1; back < kept; back += 1) {
    const at = ((drag.count - 1 - back) % SAMPLES) * 3;

    if (lastAt - (drag.samples[at + 2] ?? 0) >= 100) break;
    oldest = at;
  }

  const span = lastAt - (drag.samples[oldest + 2] ?? 0);

  if (span <= 0) return { x: 0, y: 0 };

  return {
    x: (lastX - (drag.samples[oldest] ?? 0)) / span,
    y: (lastY - (drag.samples[oldest + 1] ?? 0)) / span,
  };
}
