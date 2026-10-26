import { create, props } from "@stylexjs/stylex";
import { animate, motion, useIsPresent, useMotionValue } from "motion/react";
import { useEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement, WheelEvent } from "react";
import { Button } from "@nyte-ai/ui/button";
import type { Direction, Gesture, Layout, PeekDials } from "./motion";
import { SitePage, type Site } from "./site";

export type Landing = "tab" | "split";

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The Peek host's border box, and the page card inside it (the host less the shell's card inset). */
export interface Size {
  readonly width: number;
  readonly height: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
}

export interface Opened {
  readonly id: number;
  readonly site: Site;
  readonly link: HTMLElement;
  /** The link's rect in host coordinates, where the card grows from. */
  readonly source: Rect;
  readonly landing?: Landing;
}

/** Arc's split-view gap. */
export const SPLIT_GAP = 4;

const CARD_WIDTH = 0.8;

const CARD_MARGIN = 12;

/** Arc reserves this beside each side of the popover card, and hosts the controls in a 120pt column of 45pt rows. */
const RESERVE = 146;

const COLUMN = 120;

/** `shell.cardRadius`, Arc's 6pt page card, which a promoted Peek lands in. */
const PAGE_RADIUS = 6;

/** CoreAnimation's shadow radius is about half a CSS blur. */
const LOOKS = {
  popover: { radius: 8, shadow: "0px 8px 32px rgba(0, 0, 0, 0.475)" },
  "full-bleed": { radius: 10, shadow: "0px 2px 20px rgba(0, 0, 0, 0.475)" },
} as const;

const NO_SHADOW = "0px 0px 0px rgba(0, 0, 0, 0)";

const VECTORS = {
  down: [{ x: 0, y: 1 }],
  vertical: [
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ],
  any: [
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: -1, y: 0 },
  ],
} as const;

/** A trackpad gesture, momentum included, has ended once wheel events stop for this long. */
const WHEEL_IDLE = 150;

/** A pointer that rested this long before letting go carries no velocity. */
const STILL = 100;

interface Track {
  readonly startX: number;
  readonly startY: number;
  readonly dx: number;
  readonly dy: number;
  readonly vx: number;
  readonly vy: number;
  readonly t: number;
}

export function paneRect(size: Size, landing: Landing): Rect {
  if (landing === "tab") {
    return { left: 0, top: 0, width: size.pageWidth, height: size.pageHeight };
  }

  const width = (size.pageWidth - SPLIT_GAP) / 2;

  return { left: size.pageWidth - width, top: 0, width, height: size.pageHeight };
}

export function PeekCard({
  opened,
  size,
  dials,
  reduce,
  dark,
  onClose,
  onPromote,
  onLanded,
}: {
  readonly opened: Opened;
  readonly size: Size;
  readonly dials: PeekDials;
  readonly reduce: boolean;
  readonly dark: boolean;
  readonly onClose: (message: string) => void;
  readonly onPromote: (landing: Landing) => void;
  readonly onLanded: (landing: Landing) => void;
}): ReactElement {
  const present = useIsPresent();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Track | undefined>(undefined);
  const wheel = useRef<{ readonly track: Track; readonly timer: number } | undefined>(undefined);
  const gesture = dials.gesture;
  const look = LOOKS[dials.layout];
  const rest = restRect(size, dials.layout);
  const landing = opened.landing;
  const target = landing === undefined ? rest : paneRect(size, landing);

  const from = {
    x: opened.source.left + opened.source.width / 2 - (rest.left + rest.width / 2),
    y: opened.source.top + opened.source.height / 2 - (rest.top + rest.height / 2),
    scaleX: opened.source.width / rest.width,
    scaleY: opened.source.height / rest.height,
  };

  const grown = reduce ? { x: 0, y: 0, scaleX: 1, scaleY: 1 } : from;

  const column =
    dials.layout === "popover"
      ? Math.min(rest.left + rest.width + (RESERVE - COLUMN) / 2, size.width - COLUMN)
      : size.width - COLUMN;

  const controls = [
    { label: "Close Peek", icon: "close", run: () => onClose("Closed.") },
    { label: "Open as Tab", icon: "expand", run: () => onPromote("tab") },
    { label: "Open in Split View", icon: "split-right", run: () => onPromote("split") },
  ] as const;

  // oxlint-disable-next-line nyte-code/no-direct-effect -- focus enters the page on every open, including a reopen that catches this card mid-close
  useEffect(() => {
    scroller.current?.focus();
  }, [opened.id]);

  const follow = (track: Track): void => {
    x.set(band(track.dx, rest.width, gesture.resistance));
    y.set(band(track.dy, rest.height, gesture.resistance));
  };

  const settle = (): void => {
    if (reduce) {
      x.jump(0);
      y.jump(0);

      return;
    }

    void animate(x, 0, dials.open);
    void animate(y, 0, dials.open);
  };

  const release = (event: PointerEvent<HTMLDivElement>): void => {
    const track = drag.current;

    drag.current = undefined;

    if (track === undefined) return;
    const moving = event.timeStamp - track.t < STILL;

    if (event.type === "pointerup" && dismisses(gesture, track, moving)) {
      onClose("Closed by dragging the card away.");

      return;
    }

    settle();
  };

  const grab = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !present || landing !== undefined) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      x.stop();
      y.stop();
      const dx = unband(x.get(), rest.width, gesture.resistance);
      const dy = unband(y.get(), rest.height, gesture.resistance);

      drag.current = {
        startX: event.clientX - dx,
        startY: event.clientY - dy,
        dx,
        dy,
        vx: 0,
        vy: 0,
        t: event.timeStamp,
      };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const track = drag.current;

      if (track === undefined) return;
      drag.current = step(
        track,
        event.clientX - track.startX,
        event.clientY - track.startY,
        event.timeStamp,
      );
      follow(drag.current);
    },
    onPointerUp: release,
    onPointerCancel: release,
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    const page = scroller.current;

    if (
      page === null ||
      !present ||
      landing !== undefined ||
      event.ctrlKey ||
      drag.current !== undefined
    ) {
      return;
    }

    const current = wheel.current;
    const pullX = gesture.direction === "any" ? -event.deltaX : 0;
    const pullY = -event.deltaY;

    if (current === undefined && !overscrolls(page, gesture.direction, pullX, pullY)) return;
    window.clearTimeout(current?.timer);

    const start = current?.track ?? {
      startX: 0,
      startY: 0,
      dx: 0,
      dy: 0,
      vx: 0,
      vy: 0,
      t: event.timeStamp - 16,
    };

    const track = step(start, start.dx + pullX, start.dy + pullY, event.timeStamp);

    if (
      !VECTORS[gesture.direction].some((vector) => track.dx * vector.x + track.dy * vector.y > 0)
    ) {
      wheel.current = undefined;
      x.jump(0);
      y.jump(0);

      return;
    }

    if (dismisses(gesture, track, true)) {
      wheel.current = undefined;
      onClose("Closed by scrolling past the edge of the page.");

      return;
    }

    follow(track);
    wheel.current = {
      track,
      timer: window.setTimeout(() => {
        wheel.current = undefined;
        settle();
      }, WHEEL_IDLE),
    };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!present || landing !== undefined) return;

    if (event.key === "Escape") {
      event.preventDefault();
      onClose("Closed with Esc.");

      return;
    }

    if (event.key === "o" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onPromote("tab");

      return;
    }

    if (event.key === "Tab") trapFocus(event);
  };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`Peek: ${opened.site.host}`}
      tabIndex={-1}
      {...props(styles.envelope)}
      style={{ x, y }}
      exit={reduce || landing !== undefined ? undefined : { x: 0, y: 0, transition: dials.close }}
      onKeyDown={onKeyDown}
    >
      <motion.div
        {...props(styles.card)}
        initial={{
          ...rectStyle(rest),
          ...grown,
          borderRadius: look.radius,
          boxShadow: look.shadow,
          opacity: 0,
        }}
        animate={{
          ...rectStyle(target),
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          borderRadius: landing === undefined ? look.radius : PAGE_RADIUS,
          boxShadow: landing === undefined ? look.shadow : NO_SHADOW,
          transition: reduce
            ? dials.fade
            : landing === undefined
              ? { ...dials.open, opacity: { duration: 0.08 } }
              : dials.promote,
        }}
        exit={
          landing !== undefined
            ? { opacity: 0, transition: { duration: 0 } }
            : reduce
              ? { opacity: 0, transition: dials.fade }
              : {
                  ...from,
                  opacity: 0,
                  transition: { ...dials.close, opacity: { duration: 0.1, delay: 0.1 } },
                }
        }
        onAnimationComplete={() => {
          if (landing !== undefined) onLanded(landing);
        }}
        onWheel={onWheel}
      >
        <SitePage site={opened.site} dark={dark} scroller={scroller} handle={grab} />
      </motion.div>
      <motion.div
        {...props(styles.controls)}
        style={{ left: column, top: rest.top }}
        initial={{ opacity: 0 }}
        animate={{
          opacity: landing === undefined ? 1 : 0,
          pointerEvents: landing === undefined ? "auto" : "none",
          transition: { duration: 0.15, delay: reduce || landing !== undefined ? 0 : 0.1 },
        }}
        exit={{ opacity: 0, transition: { duration: 0.1 } }}
      >
        {(dials.alternateOrder ? [...controls].reverse() : controls).map((control) => (
          <Button
            key={control.label}
            iconOnly
            icon={control.icon}
            variant={dials.layout === "popover" ? "outline" : "solid"}
            aria-label={control.label}
            aria-keyshortcuts={control.label === "Open as Tab" ? "Meta+O" : undefined}
            onClick={control.run}
          />
        ))}
      </motion.div>
    </motion.div>
  );
}

function restRect(size: Size, layout: Layout): Rect {
  const width = layout === "popover" ? size.width * CARD_WIDTH : size.width;

  return {
    left: (size.width - width) / 2,
    top: CARD_MARGIN,
    width,
    height: size.height - 2 * CARD_MARGIN,
  };
}

export function rectStyle(rect: Rect) {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** Arc's rule: 75pt with a qualifying velocity in a dismissing direction, or 152pt without. */
function dismisses(gesture: Gesture, track: Track, moving: boolean): boolean {
  return VECTORS[gesture.direction].some((vector) => {
    const travel = track.dx * vector.x + track.dy * vector.y;
    const speed = moving ? track.vx * vector.x + track.vy * vector.y : 0;

    return (
      travel >= gesture.distance ||
      (travel >= gesture.flingDistance && speed >= gesture.flingVelocity)
    );
  });
}

/** Whether a wheel delta pushes past an edge of the page that a dismissing direction pulls from. */
function overscrolls(
  page: HTMLElement,
  direction: Direction,
  pullX: number,
  pullY: number,
): boolean {
  if (Math.abs(pullX) > Math.abs(pullY)) return direction === "any";

  if (pullY > 0) return page.scrollTop <= 0;

  return direction !== "down" && page.scrollTop + page.clientHeight >= page.scrollHeight - 1;
}

function step(track: Track, dx: number, dy: number, t: number): Track {
  const seconds = Math.max(t - track.t, 1) / 1000;

  return {
    ...track,
    dx,
    dy,
    vx: 0.7 * ((dx - track.dx) / seconds) + 0.3 * track.vx,
    vy: 0.7 * ((dy - track.dy) / seconds) + 0.3 * track.vy,
    t,
  };
}

/** iOS-style rubber band: the card trails the gesture and never travels past `size`. */
function band(distance: number, size: number, resistance: number): number {
  return Math.sign(distance) * size * (1 - 1 / ((Math.abs(distance) * resistance) / size + 1));
}

function unband(offset: number, size: number, resistance: number): number {
  const ratio = Math.min(Math.abs(offset) / size, 0.99);

  return (Math.sign(offset) * size * ratio) / (resistance * (1 - ratio));
}

function trapFocus(event: KeyboardEvent<HTMLElement>): void {
  const selector = "button:not(:disabled), [tabindex='0']";
  const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(selector));
  const first = stops.at(0);
  const last = stops.at(-1);
  const active = document.activeElement;

  if (first === undefined || last === undefined) return;

  if (event.shiftKey && (active === first || active === event.currentTarget)) {
    event.preventDefault();
    last.focus();

    return;
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

const styles = create({
  envelope: {
    position: "absolute",
    inset: 0,
    zIndex: 2,
    pointerEvents: "none",
    outlineStyle: "none",
  },
  card: {
    position: "absolute",
    overflow: "clip",
    pointerEvents: "auto",
    outlineStyle: "none",
  },
  controls: {
    position: "absolute",
    display: "grid",
    gridAutoRows: 45,
    justifyItems: "center",
    alignItems: "center",
    width: COLUMN,
  },
});
