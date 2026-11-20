import { useRef } from "react";
import type { RefObject } from "react";
import type { AppMessage } from "@nyte-ai/plugin/design/board-protocol";
import { post } from "./bridge.ts";
import type { WorldRect } from "./frame-chrome.tsx";

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export type Wheel = Omit<Extract<AppMessage, { kind: "wheel" }>, "kind">;

type Aim =
  | { readonly kind: "free" }
  | { readonly kind: "framing"; readonly selector: string }
  | {
      readonly kind: "waiting";
      readonly selector: string;
      readonly always: boolean;
      readonly framing: string | null;
    }
  | { readonly kind: "reading"; readonly back: Camera; readonly framing: string | null };

interface CameraState {
  at: Camera;
  flight: number;
  aim: Aim;
  reported: number;
}

export interface BoardCamera {
  readonly at: () => Camera;
  readonly apply: () => void;
  readonly moveTo: (at: Camera) => void;
  readonly showAll: (selector: string, always: boolean, instant: boolean) => void;
  readonly follow: (selector: string, always: boolean) => void;
  readonly reframe: () => void;
  readonly stop: () => void;
  readonly forget: () => void;
  readonly wheel: (input: Wheel) => void;
  readonly actual: () => void;
  readonly read: (node: Element) => void;
  readonly back: () => void;
}

export const EVERY_FRAME = "[data-frame-box]";

export const SELECTION = '[data-ring="you"]';

const LEGIBLE_ZOOM = 0.8;

const LABEL_ROOM = 28;

const MIN_ZOOM = 0.08;

const MAX_ZOOM = 16;

const FLIGHT_MS = 260;

const margin = (side: number): number => Math.min(80, Math.max(16, side * 0.1));

function readFraming(aim: Aim): string | null {
  if (aim.kind === "framing") return aim.selector;

  return aim.kind === "waiting" ? aim.framing : null;
}

function frame(selector: string | null): Aim {
  return selector === null ? { kind: "free" } : { kind: "framing", selector };
}

export function useCamera(input: {
  readonly stage: RefObject<HTMLDivElement | null>;
  readonly world: RefObject<HTMLDivElement | null>;
  readonly onMove: () => void;
}): BoardCamera {
  const state = useRef<CameraState>({
    at: { x: 80, y: 96, zoom: 0.6 },
    flight: 0,
    aim: { kind: "framing", selector: EVERY_FRAME },
    reported: 0,
  });

  const apply = (): void => {
    const next = state.current.at;

    input.world.current?.style.setProperty(
      "transform",
      `translate(${String(next.x)}px, ${String(next.y)}px) scale(${String(next.zoom)})`,
    );
    input.stage.current?.style.setProperty("--zoom", String(next.zoom));
    input.onMove();
    const percent = Math.round(next.zoom * 100);

    if (percent === state.current.reported) return;
    state.current.reported = percent;
    post({ kind: "zoom", zoom: next.zoom });
  };

  const setFraming = (selector: string | null): void => {
    const aim = state.current.aim;

    state.current.aim = aim.kind === "waiting" ? { ...aim, framing: selector } : frame(selector);
  };

  const fly = (to: Camera, instant: boolean): void => {
    const from = state.current.at;
    const started = performance.now();
    state.current.flight += 1;
    const mine = state.current.flight;

    if (instant || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      state.current.at = to;
      input.stage.current?.removeAttribute("data-moving");
      apply();

      return;
    }

    input.stage.current?.setAttribute("data-moving", "");

    const step = (now: number): void => {
      if (state.current.flight !== mine) return;
      const t = Math.min(1, (now - started) / FLIGHT_MS);
      const eased = 1 - (1 - t) ** 4;

      state.current.at = {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
        zoom: from.zoom + (to.zoom - from.zoom) * eased,
      };
      apply();

      if (t < 1) requestAnimationFrame(step);
      else input.stage.current?.removeAttribute("data-moving");
    };

    requestAnimationFrame(step);
  };

  const show = (rect: WorldRect, always: boolean, instant: boolean): boolean => {
    const bounds = input.stage.current?.getBoundingClientRect();

    if (bounds === undefined || rect.width <= 0) return false;
    const now = state.current.at;

    const fit = Math.min(
      (bounds.width - 2 * margin(bounds.width)) / rect.width,
      (bounds.height - 2 * margin(bounds.height) - LABEL_ROOM) / rect.height,
    );

    const zoom = always ? Math.min(1, fit) : Math.min(now.zoom, fit);
    const left = rect.x * now.zoom + now.x;
    const top = rect.y * now.zoom + now.y;

    const visible =
      left >= 24 &&
      top >= 24 &&
      left + rect.width * now.zoom <= bounds.width - 24 &&
      top + rect.height * now.zoom <= bounds.height - 24;

    if (visible && !always) return false;
    fly(
      {
        x: (bounds.width - rect.width * zoom) / 2 - rect.x * zoom,
        y: (bounds.height - rect.height * zoom) / 2 - rect.y * zoom,
        zoom,
      },
      instant,
    );

    return true;
  };

  const worldRect = (node: Element): WorldRect => {
    const bounds = input.stage.current?.getBoundingClientRect() ?? new DOMRect();
    const rect = node.getBoundingClientRect();
    const now = state.current.at;

    return {
      x: (rect.left - bounds.left - now.x) / now.zoom,
      y: (rect.top - bounds.top - now.y) / now.zoom,
      width: rect.width / now.zoom,
      height: rect.height / now.zoom,
    };
  };

  const showAll = (selector: string, always: boolean, instant: boolean): void => {
    const nodes = [...(input.world.current?.querySelectorAll(selector) ?? [])];

    if (nodes.length === 0) return;
    const rects = nodes.map(worldRect);
    const x = Math.min(...rects.map((rect) => rect.x));
    const y = Math.min(...rects.map((rect) => rect.y));

    const moved = show(
      {
        x,
        y,
        width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
        height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
      },
      always,
      instant,
    );

    if (always) setFraming(selector);
    else if (moved) setFraming(null);
  };

  const forget = (): void => {
    const aim = state.current.aim;

    if (aim.kind === "waiting") state.current.aim = frame(aim.framing);
  };

  const follow = (selector: string, always: boolean): void => {
    const nodes = [...(input.world.current?.querySelectorAll(selector) ?? [])];

    if (nodes.every((node) => node.getBoundingClientRect().width === 0)) {
      state.current.aim = {
        kind: "waiting",
        selector,
        always,
        framing: readFraming(state.current.aim),
      };

      return;
    }

    forget();
    showAll(selector, always, false);
  };

  const stop = (): void => {
    state.current.flight += 1;
    state.current.aim = { kind: "free" };
    input.stage.current?.removeAttribute("data-moving");
  };

  return {
    at: () => state.current.at,
    apply,
    moveTo: (at) => {
      state.current.at = at;
      apply();
    },
    showAll,
    follow,
    reframe: () => {
      const framing = readFraming(state.current.aim);

      if (framing !== null) showAll(framing, true, true);
      const aim = state.current.aim;

      if (aim.kind === "waiting") follow(aim.selector, aim.always);
    },
    stop,
    forget,
    wheel: (wheel) => {
      stop();
      const now = state.current.at;

      if (!wheel.zoom) {
        state.current.at = { ...now, x: now.x - wheel.deltaX, y: now.y - wheel.deltaY };
        apply();

        return;
      }

      const bounds = input.stage.current?.getBoundingClientRect() ?? new DOMRect();

      const zoom = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, now.zoom * Math.exp(-wheel.deltaY * 0.01)),
      );

      const pointerX = wheel.x - bounds.left;
      const pointerY = wheel.y - bounds.top;

      state.current.at = {
        x: pointerX - ((pointerX - now.x) / now.zoom) * zoom,
        y: pointerY - ((pointerY - now.y) / now.zoom) * zoom,
        zoom,
      };
      apply();
    },
    actual: () => {
      const bounds = input.stage.current?.getBoundingClientRect();
      const now = state.current.at;

      if (bounds === undefined) return;
      stop();
      fly(
        {
          x: bounds.width / 2 - (bounds.width / 2 - now.x) / now.zoom,
          y: bounds.height / 2 - (bounds.height / 2 - now.y) / now.zoom,
          zoom: 1,
        },
        false,
      );
    },
    read: (node) => {
      if (state.current.at.zoom >= LEGIBLE_ZOOM) return;
      state.current.aim = {
        kind: "reading",
        back: state.current.at,
        framing: readFraming(state.current.aim),
      };
      show(worldRect(node), true, false);
    },
    back: () => {
      const aim = state.current.aim;

      if (aim.kind !== "reading") return;
      state.current.aim = frame(aim.framing);
      fly(aim.back, false);
    },
  };
}
