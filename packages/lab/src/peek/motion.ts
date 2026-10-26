import { useDialKit, type TransitionConfig } from "dialkit";
import type { Transition } from "motion/react";

export const TRIGGERS = ["shift", "other-sites", "off"] as const;

export const LAYOUTS = ["popover", "full-bleed"] as const;

export const DIRECTIONS = ["down", "vertical", "any"] as const;

export type Trigger = (typeof TRIGGERS)[number];

export type Layout = (typeof LAYOUTS)[number];

export type Direction = (typeof DIRECTIONS)[number];

export interface Gesture {
  readonly direction: Direction;
  readonly flingDistance: number;
  readonly distance: number;
  readonly flingVelocity: number;
  readonly resistance: number;
}

export interface PeekDials {
  readonly trigger: Trigger;
  readonly layout: Layout;
  readonly open: Transition;
  readonly close: Transition;
  readonly promote: Transition;
  readonly fade: Transition;
  readonly recede: number;
  readonly pageOpacity: number;
  readonly gesture: Gesture;
  readonly alternateOrder: boolean;
  readonly undoSeconds: number;
  readonly reduceMotion: boolean;
}

/** Arc stores springs as response (seconds per cycle) and damping ratio; motion takes physics. */
function spring(response: number, dampingRatio: number) {
  const omega = (2 * Math.PI) / response;

  return {
    type: "spring",
    stiffness: Math.round(omega * omega),
    damping: Math.round(2 * dampingRatio * omega * 10) / 10,
    mass: 1,
  } as const;
}

/**
 * Defaults are Arc 1.170's, read from its binary, where it stores them. The page's opacity is one
 * of three Arc stores; the gesture's direction, fling velocity and resistance, the undo retention and
 * the trigger default are this board's guesses.
 */
export function usePeekDials(): PeekDials {
  const values = useDialKit("Peek", {
    trigger: {
      type: "select",
      options: [
        { value: "shift", label: "Shift-click" },
        { value: "other-sites", label: "Click links to other sites" },
        { value: "off", label: "Off" },
      ],
      default: "shift",
    },
    layout: {
      type: "select",
      options: [
        { value: "popover", label: "Popover" },
        { value: "full-bleed", label: "Full-bleed" },
      ],
      default: "popover",
    },
    popover: { open: spring(0.245, 0.865), close: spring(0.225, 0.895) },
    fullBleed: { open: spring(0.18, 0.885), close: spring(0.18, 0.9) },
    page: {
      recede: [18, 0, 60, 1],
      opacity: [0.7, 0, 1, 0.05],
    },
    gesture: {
      direction: {
        type: "select",
        options: [
          { value: "down", label: "Down" },
          { value: "vertical", label: "Up or down" },
          { value: "any", label: "Any direction" },
        ],
        default: "down",
      },
      flingDistance: [75, 0, 200, 1],
      distance: [152, 0, 400, 1],
      flingVelocity: [400, 0, 2000, 10],
      resistance: [0.55, 0.1, 1, 0.05],
    },
    alternateOrder: false,
    undoSeconds: [5, 1, 30, 1],
    reduceMotion: false,
    quarterSpeed: false,
  });

  const scale = values.quarterSpeed ? 4 : 1;
  const springs = values.layout === "full-bleed" ? values.fullBleed : values.popover;

  return {
    trigger: TRIGGERS.find((trigger) => trigger === values.trigger) ?? "shift",
    layout: LAYOUTS.find((layout) => layout === values.layout) ?? "popover",
    open: toTransition(springs.open, scale),
    close: toTransition(springs.close, scale),
    promote: toTransition(values.fullBleed.open, scale),
    fade: { type: "tween", duration: 0.3 * scale, ease: "easeOut" },
    recede: values.page.recede,
    pageOpacity: values.page.opacity,
    gesture: {
      direction: DIRECTIONS.find((direction) => direction === values.gesture.direction) ?? "down",
      flingDistance: values.gesture.flingDistance,
      distance: values.gesture.distance,
      flingVelocity: values.gesture.flingVelocity,
      resistance: values.gesture.resistance,
    },
    alternateOrder: values.alternateOrder,
    undoSeconds: values.undoSeconds,
    reduceMotion: values.reduceMotion,
  };
}

/** Slowing a spring by `scale` divides stiffness by scale² and damping by scale, keeping its shape. */
function toTransition(config: TransitionConfig, scale: number): Transition {
  if (config.type === "easing") {
    return { type: "tween", duration: config.duration * scale, ease: config.ease };
  }

  if (config.visualDuration !== undefined) {
    return { ...config, visualDuration: config.visualDuration * scale };
  }

  return {
    ...config,
    stiffness: (config.stiffness ?? 100) / scale ** 2,
    damping: (config.damping ?? 10) / scale,
  };
}
