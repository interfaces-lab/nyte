import { createTheme } from "@stylexjs/stylex";
import { useEffectEvent, useRef, useState } from "react";
import type { RefObject } from "react";
import { flushSync } from "react-dom";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { sidebarMotion } from "../theme/tokens.stylex.ts";
import { useSidebar } from "./use-sidebar.ts";

const THRESHOLD = 16;

const AXIS_RATIO = 1.5;

const IDLE_MS = 140;

const PUSH_MS = 550;

export const sidebarPush = createTheme(sidebarMotion, {
  "--nyte-sidebar-slide-duration": "0s",
  "--nyte-sidebar-slide-offset": "0%",
  "--nyte-sidebar-resize-duration": {
    default: `${String(PUSH_MS)}ms`,
    "@media (prefers-reduced-motion: reduce)": "0s",
  },
  "--nyte-sidebar-resize-delay": "0s",
  "--nyte-sidebar-resize-easing":
    "linear(0, 0.1236, 0.341, 0.5416, 0.6959, 0.8046, 0.8772, 0.9242, 0.9538, 0.9722, 0.9834, 0.9901, 0.9942, 0.9966, 0.998, 0.9988, 0.9993, 1)",
});

type SwipePhase = "deciding" | "vertical" | "scroller" | "away" | "toggled";

interface Swipe {
  readonly phase: SwipePhase;
  readonly toward: 1 | -1;
  readonly x: number;
  readonly y: number;
}

interface SwipeStep {
  readonly swipe: Swipe;
  readonly toggles: boolean;
}

/** Opens and closes the sidebar with a two-finger swipe over `root`. */
export function useSidebarSwipe(root: RefObject<HTMLElement | null>): boolean {
  const sidebar = useSidebar();
  const [pushing, setPushing] = useState(false);
  const gesture = useRef<Swipe | undefined>(undefined);
  const idleTimer = useRef<number | undefined>(undefined);
  const pushes = useRef(0);

  const onWheel = useEffectEvent((event: WheelEvent): void => {
    const element = root.current;

    if (element === null) return;

    if (gesture.current === undefined) {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.shiftKey ||
        event.buttons !== 0 ||
        event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL
      ) {
        return;
      }

      gesture.current = startSwipe(sidebar.open ? 1 : -1);
    }

    const step = stepSwipe(gesture.current, event.deltaX, event.deltaY, (direction) =>
      scrollerCanTake(event, element, direction),
    );

    gesture.current = step.swipe;
    window.clearTimeout(idleTimer.current);

    idleTimer.current = window.setTimeout(() => {
      gesture.current = undefined;
    }, IDLE_MS);

    if (!step.toggles) return;
    const push = pushes.current + 1;
    pushes.current = push;
    flushSync(() => {
      setPushing(true);
      sidebar.setOpen(step.swipe.toward < 0);
    });

    const transitions = element
      .getAnimations({ subtree: true })
      .filter((animation) => animation instanceof CSSTransition);

    void Promise.allSettled(transitions.map((transition) => transition.finished)).then(() => {
      if (pushes.current === push) setPushing(false);
    });
  });

  useMountEffect(() => {
    const element = root.current;

    if (element === null) return;
    const listener = (event: WheelEvent): void => onWheel(event);
    element.addEventListener("wheel", listener, { passive: true });

    return () => {
      element.removeEventListener("wheel", listener);
      window.clearTimeout(idleTimer.current);
    };
  });

  return pushing;
}

function startSwipe(toward: 1 | -1): Swipe {
  return { phase: "deciding", toward, x: 0, y: 0 };
}

function stepSwipe(
  swipe: Swipe,
  dx: number,
  dy: number,
  scrollerTakes: (direction: 1 | -1) => boolean,
): SwipeStep {
  const horizontal = Math.abs(dx) > Math.abs(dy) * AXIS_RATIO;
  const reverses = horizontal && dx * swipe.x < 0;

  if (swipe.phase === "vertical" && horizontal) {
    return stepSwipe(startSwipe(swipe.toward), dx, dy, scrollerTakes);
  }

  if ((swipe.phase === "toggled" || swipe.phase === "away") && reverses) {
    const toward = swipe.phase === "toggled" ? (swipe.toward === 1 ? -1 : 1) : swipe.toward;

    return stepSwipe(startSwipe(toward), dx, dy, scrollerTakes);
  }

  if (swipe.phase !== "deciding") return { swipe, toggles: false };

  const next = { ...swipe, x: swipe.x + dx, y: swipe.y + dy };

  if (dx !== 0 && scrollerTakes(dx > 0 ? 1 : -1)) {
    return { swipe: { ...next, phase: "scroller" }, toggles: false };
  }

  if (Math.hypot(next.x, next.y) < THRESHOLD) return { swipe: next, toggles: false };

  if (Math.abs(next.x) < Math.abs(next.y) * AXIS_RATIO) {
    return { swipe: { ...next, phase: "vertical" }, toggles: false };
  }

  if (next.x * next.toward > 0) return { swipe: { ...next, phase: "toggled" }, toggles: true };

  return { swipe: { ...next, phase: "away" }, toggles: false };
}

function scrollerCanTake(event: WheelEvent, root: Element, direction: 1 | -1): boolean {
  const path = event.composedPath();

  return path
    .slice(0, path.indexOf(root))
    .some((target) => target instanceof Element && canScrollSideways(target, direction));
}

function canScrollSideways(element: Element, direction: 1 | -1): boolean {
  const overflow = getComputedStyle(element).overflowX;
  const room = element.scrollWidth - element.clientWidth;

  if ((overflow !== "auto" && overflow !== "scroll") || room < 1) return false;

  return direction > 0 ? element.scrollLeft < room - 1 : element.scrollLeft > 0;
}
