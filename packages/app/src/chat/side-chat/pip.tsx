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

/** Spread on what drags the window: its header, or the whole pill. */
export const GRIP = { "data-pip-grip": "" } as const;

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * One drag, allocated when it starts and written in place on every move, so a move allocates
 * nothing. `low` and `high` are the offsets at which the window meets the area's edges; `followed`
 * is where the pointer alone would have put it at the last move. `samples` is a ring of the last
 * `SAMPLES` pointer positions as x, y and time, `count` how many were ever written.
 */
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

/** How far ahead a release's velocity throws the window when it picks a corner. */
const THROW_MS = 180;

const MOVE_SLOP = 4;

/** How much of a drag past the area's edge the window follows. */
const RESISTANCE = 0.3;

const SPRING: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 1 };

const INSTANT: Transition = { duration: 0 };

const FADE: Transition = { duration: 0.14, ease: "easeOut" };

const FOLD: Transition = { duration: 0.1, ease: "easeOut" };

/** The window's face comes back once the card has mostly grown, so its text never reflows in view. */
const UNFOLD: Transition = { duration: 0.16, delay: 0.14, ease: "easeOut" };

const styles = create({
  /** Ends where the chat's composer dock starts, so the window never covers the composer. */
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
  /** The open size, capped as the card is. */
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

/** Pins the window's face to the card's corner, so folding clips it from the far side. */
const pinned = create({
  "top-start": { insetBlockStart: 0, insetInlineStart: 0 },
  "top-end": { insetBlockStart: 0, insetInlineEnd: 0 },
  "bottom-start": { insetBlockEnd: 0, insetInlineStart: 0 },
  "bottom-end": { insetBlockEnd: 0, insetInlineEnd: 0 },
});

/** Sets the pill in the card's corner, where it lands, so it never drifts while the card shrinks. */
const settled = create({
  "top-start": { alignItems: "flex-start", justifyContent: "flex-start" },
  "top-end": { alignItems: "flex-start", justifyContent: "flex-end" },
  "bottom-start": { alignItems: "flex-end", justifyContent: "flex-start" },
  "bottom-end": { alignItems: "flex-end", justifyContent: "flex-end" },
});

/**
 * A picture-in-picture window over its positioned parent, kept `bottom` pixels above the parent's
 * foot. It sits in a corner, anchored there by insets, so a change of size keeps the corner. Drag
 * it by an element marked `GRIP` and let go, and it flies to the corner its velocity points at;
 * past the area's edge it follows at a third of the pointer. Arrow keys on a focused grip move it
 * to the next corner the same way. A move re-anchors the window in its new corner at the offset it
 * already shows, so it never jumps, then springs it home. Folded, the same card shrinks into its corner around `pill`,
 * so window and pill read as one object, and the face not in use is inert.
 *
 * The grip captures the pointer, so a grip that is a button still clicks, and pressing a grip
 * leaves focus where it was. On a move the inset is read off the window, so it follows the
 * spacing unit; inline start is taken as the physical left, as the app lays out left to right.
 */
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

/**
 * The window's next offset on one axis after the pointer moved `delta`: free between the offsets
 * `low` and `high` where it meets the area's edges, and at a fraction of the pointer past them.
 */
function resist(delta: number, offset: number, low: number, high: number): number {
  const next = offset + delta;
  const outside = next < low || next > high;

  return outside ? offset + delta * RESISTANCE : next;
}

/** The corner an arrow `key` moves the window to from `corner`, or null for any other key. */
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

/** Writes the pointer's position and time into the drag's sample ring, over its oldest sample. */
function record(drag: Drag, event: PointerEvent<HTMLElement>): void {
  const at = (drag.count % SAMPLES) * 3;

  drag.samples[at] = event.clientX;
  drag.samples[at + 1] = event.clientY;
  drag.samples[at + 2] = event.timeStamp;
  drag.count += 1;
}

/**
 * Pixels per millisecond between the newest sample and the oldest one within 100 ms of it, read
 * from the ring newest first; still when the pointer paused before letting go.
 */
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
