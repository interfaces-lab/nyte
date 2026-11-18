import { props } from "@stylexjs/stylex";
import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { readSpanKey } from "@nyte-ai/plugin/design/board-protocol";
import type { BoardSubject, Span } from "@nyte-ai/plugin/design/board-protocol";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { boardStyles } from "./board.stylex.ts";
import { onCommand, post, useView } from "./bridge.ts";
import type { Command } from "./bridge.ts";
import { FrameChrome, Ring } from "./frame-chrome.tsx";
import type { Point, WorldRect } from "./frame-chrome.tsx";
import { readVia } from "./runtime.ts";
import { currentDrawn, hold, release, useDrawn } from "./sheets.ts";
import type { FrameBox, SheetBox } from "./sheets.ts";

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface Typing {
  readonly node: HTMLElement;
  readonly words: string;
}

type Gesture =
  | {
      readonly kind: "pan";
      readonly pointerX: number;
      readonly pointerY: number;
      readonly startX: number;
      readonly startY: number;
    }
  | {
      readonly kind: "frame";
      readonly frame: FrameBox;
      readonly pointerX: number;
      readonly pointerY: number;
    };

type Payload =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "move"; readonly x: number; readonly y: number };

interface Edit {
  key: Span;
  sent: boolean;
  queued: Payload | null;
}

interface Anchors {
  readonly signature: string;
  readonly settled: boolean;
  readonly at: ReadonlyMap<string, Point>;
}

interface Resume {
  readonly camera: Camera;
  readonly framing: string | null;
}

const GAP = 160;

const LEGIBLE_ZOOM = 0.8;

const EVERY_FRAME = "[data-frame-box]";

const SELECTION = '[data-ring="you"]';

const OPEN_ROOM = 100_000;

const LABEL_ROOM = 28;

const FAILURE: Point = { x: 360, y: 120 };

const margin = (side: number): number => Math.min(80, Math.max(16, side * 0.1));

const MIN_ZOOM = 0.08;

const MAX_ZOOM = 16;

const FLIGHT_MS = 260;

const GROUPS = ["controls", "blocks", "screens"] as const;

function group(path: string): number {
  const at = GROUPS.findIndex((name) => path.includes(`/${name}/`) || path.includes(`/${name}.`));

  return at === -1 ? GROUPS.length : at;
}

function extent(sheet: SheetBox): Point {
  if (sheet.frames.length === 0) return FAILURE;

  return {
    x: Math.max(...sheet.frames.map((frame) => frame.x + frame.width)),
    y: Math.max(...sheet.frames.map((frame) => frame.y + frame.height)),
  };
}

function placeSheets(sheets: readonly SheetBox[]): ReadonlyMap<string, Point> {
  const at = new Map<string, Point>();
  let y = 0;

  for (const row of [...GROUPS, "other"].keys()) {
    let x = 0;
    let tallest = 0;

    for (const sheet of sheets.filter(
      (item) => group(item.path) === row && (item.frames.length > 0 || item.error !== null),
    )) {
      const size = extent(sheet);
      at.set(sheet.path, { x, y });
      x += size.x + GAP;
      tallest = Math.max(tallest, size.y);
    }

    if (tallest > 0) y += tallest + GAP;
  }

  return at;
}

function readKeys(node: Element): readonly string[] {
  const own = node.getAttribute("data-src");

  return own === null ? readVia(node) : [...readVia(node), own];
}

function findNodes(host: HTMLElement, key: string): readonly Element[] {
  const draws = (node: Element): boolean =>
    node.getAttribute("data-src") === key || readVia(node).includes(key);

  return [...host.querySelectorAll("[data-src]")].filter((node) => {
    if (!draws(node)) return false;

    for (let up = node.parentElement; up !== null && up !== host; up = up.parentElement)
      if (draws(up)) return false;

    return true;
  });
}

function measureRings(
  nodes: readonly Element[],
  sheets: readonly SheetBox[],
  placed: ReadonlyMap<string, Point>,
  held: { readonly key: string; readonly at: Point } | null,
): readonly (WorldRect & { readonly node: Element })[] {
  return sheets.flatMap((sheet) => {
    const at = placed.get(sheet.path);

    return at === undefined
      ? []
      : sheet.frames.flatMap((frame) => {
          const box = frame.node.getBoundingClientRect();
          const scale = frame.width > 0 && box.width > 0 ? box.width / frame.width : 1;
          const place = held?.key === frame.key ? held.at : frame;

          return nodes
            .filter((node) => frame.node.contains(node))
            .map((node) => {
              const rect = node.getBoundingClientRect();

              return {
                x: at.x + place.x + (rect.left - box.left) / scale,
                y: at.y + place.y + (rect.top - box.top) / scale,
                width: rect.width / scale,
                height: rect.height / scale,
                node,
              };
            });
        });
  });
}

function findRoom(frame: WorldRect, frames: readonly WorldRect[]): number {
  return Math.max(
    0,
    Math.min(
      OPEN_ROOM,
      ...frames.flatMap((other) =>
        other !== frame &&
        other.y < frame.y &&
        other.x < frame.x + frame.width &&
        other.x + other.width > frame.x
          ? [frame.y - other.y - other.height]
          : [],
      ),
    ),
  );
}

function findLit(host: HTMLElement, subject: BoardSubject | null): string | null {
  if (subject === null || subject.kind !== "span") return null;

  const holders = [...host.querySelectorAll("[data-src]")]
    .flatMap(readKeys)
    .flatMap((key) => {
      const span = readSpanKey(key);

      return span !== undefined &&
        span.path === subject.path &&
        span.start <= subject.start &&
        span.end >= subject.end
        ? [{ key, size: span.end - span.start }]
        : [];
    })
    .toSorted((left, right) => left.size - right.size);

  return holders[0]?.key ?? null;
}

function findGlowing(
  sheets: readonly SheetBox[],
  agents: readonly BoardSubject[],
): ReadonlySet<string> {
  return new Set(
    agents.flatMap((subject) =>
      sheets
        .filter((sheet) => sheet.reads.includes(subject.path))
        .flatMap((sheet) => {
          const touched = sheet.frames.filter((frame) =>
            [frame.node, ...frame.node.querySelectorAll("[data-src]")].some((part) =>
              readKeys(part).some((key) => {
                const span = readSpanKey(key);

                return (
                  subject.kind === "span" &&
                  span?.path === subject.path &&
                  span.start < subject.end &&
                  span.end > subject.start
                );
              }),
            ),
          );

          return (touched.length === 0 ? sheet.frames : touched).map((frame) => frame.key);
        }),
    ),
  );
}

/**
 * Every design file on one surface. The camera is written straight to the DOM, so a pan or a pinch never renders React.
 *
 * Showing a rectangle of the world centres it, and zooms out only when it doesn't fit. What the camera was last asked to
 * frame, it keeps framing as the board changes size, until the person moves it. When the app says the light moved
 * somewhere else, the camera goes to it once it is drawn here, unless the person moves the camera or selects something
 * first. The light the board opens on, as in a window that just opened, it frames.
 *
 * A click selects the instance the pointer is on as one thing, and Cmd goes to the element that draws it. A double
 * click types into literal words; words that come from an expression stay read-only. The words being typed into take
 * the selection's ring in place of the browser's focus outline, and the ring grows with them.
 *
 * A frame's name sits above it while there is room on screen; zoomed far out, or with a frame close above, it shows
 * above the frame only while the pointer is on it. A frame being carried rises over the others, its name with it.
 */
export function Board(input: { readonly host: HTMLElement }): ReactElement {
  const host = input.host;
  const drawn = useDrawn();
  const view = useView();
  const [pointed, setPointed] = useState<string | null>(null);
  const [pointedFrame, setPointedFrame] = useState<string | null>(null);
  const [editing, setEditing] = useState<Typing | null>(null);
  const [readOnly, setReadOnly] = useState<Element | null>(null);
  const [panning, setPanning] = useState(false);
  const [held, setHeld] = useState<{ readonly key: string; readonly at: Point } | null>(null);
  const [anchors, setAnchors] = useState<Anchors>({
    signature: "",
    settled: false,
    at: new Map(),
  });
  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const camera = useRef<Camera>({ x: 80, y: 96, zoom: 0.6 });
  const gesture = useRef<Gesture | null>(null);
  const edit = useRef<Edit | null>(null);
  const flight = useRef(0);
  const framing = useRef<string | null>(EVERY_FRAME);
  const opening = useRef(true);
  const waiting = useRef<{ readonly selector: string; readonly always: boolean } | null>(null);
  const resume = useRef<Resume | null>(null);
  const reported = useRef(0);

  const sheets = drawn.sheets;

  const signature = sheets
    .map(
      (sheet) =>
        `${sheet.path}:${String(sheet.frames.length)}:${sheet.error === null ? "" : "failed"}`,
    )
    .join("|");

  const settled = sheets.every((sheet) =>
    sheet.frames.every((frame) => frame.width > 0 && frame.height > 0),
  );

  const stale = anchors.signature !== signature || !anchors.settled;
  const placed = stale ? placeSheets(sheets) : anchors.at;

  if (
    stale &&
    (anchors.signature !== signature ||
      anchors.settled !== settled ||
      [...placed].some((entry) => {
        const at = anchors.at.get(entry[0]);

        return at?.x !== entry[1].x || at.y !== entry[1].y;
      }))
  )
    setAnchors({ signature, settled, at: placed });
  const lit = editing === null ? findLit(host, view.lights.you) : null;
  const glowing = findGlowing(sheets, view.lights.agents);

  const frames = sheets.flatMap((sheet) => {
    const at = placed.get(sheet.path);

    return at === undefined || sheet.error !== null
      ? []
      : sheet.frames.map((frame) => {
          const place = held?.key === frame.key ? held.at : frame;

          return {
            key: frame.key,
            x: at.x + place.x,
            y: at.y + place.y,
            width: frame.width,
            height: frame.height,
          };
        });
  });

  const rooms = new Map(frames.map((frame) => [frame.key, findRoom(frame, frames)]));

  const apply = (): void => {
    const next = camera.current;

    if (world.current !== null)
      world.current.style.transform = `translate(${String(next.x)}px, ${String(next.y)}px) scale(${String(next.zoom)})`;
    stage.current?.style.setProperty("--zoom", String(next.zoom));
    const percent = Math.round(next.zoom * 100);

    if (percent === reported.current) return;
    reported.current = percent;
    post({ kind: "zoom", zoom: next.zoom });
  };

  const fly = (to: Camera, instant: boolean): void => {
    const from = { ...camera.current };
    const started = performance.now();
    flight.current += 1;
    const mine = flight.current;

    if (instant || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      camera.current = to;
      stage.current?.removeAttribute("data-moving");
      apply();

      return;
    }

    stage.current?.setAttribute("data-moving", "");

    const step = (now: number): void => {
      if (flight.current !== mine) return;
      const t = Math.min(1, (now - started) / FLIGHT_MS);
      const eased = 1 - (1 - t) ** 4;

      camera.current = {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
        zoom: from.zoom + (to.zoom - from.zoom) * eased,
      };
      apply();

      if (t < 1) requestAnimationFrame(step);
      else stage.current?.removeAttribute("data-moving");
    };

    requestAnimationFrame(step);
  };

  const show = (rect: WorldRect, always: boolean, instant: boolean): boolean => {
    const bounds = stage.current?.getBoundingClientRect();

    if (bounds === undefined || rect.width <= 0) return false;
    const now = camera.current;

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
    const bounds = stage.current?.getBoundingClientRect() ?? new DOMRect();
    const rect = node.getBoundingClientRect();
    const now = camera.current;

    return {
      x: (rect.left - bounds.left - now.x) / now.zoom,
      y: (rect.top - bounds.top - now.y) / now.zoom,
      width: rect.width / now.zoom,
      height: rect.height / now.zoom,
    };
  };

  const showAll = (selector: string, always: boolean, instant: boolean): void => {
    const nodes = [...(world.current?.querySelectorAll(selector) ?? [])];

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

    if (always) framing.current = selector;
    else if (moved) framing.current = null;
  };

  const follow = (selector: string, always: boolean): void => {
    const nodes = [...(world.current?.querySelectorAll(selector) ?? [])];

    if (nodes.every((node) => node.getBoundingClientRect().width === 0)) {
      waiting.current = { selector, always };

      return;
    }

    waiting.current = null;
    showAll(selector, always, false);
  };

  const reframe = (): void => {
    if (framing.current !== null) showAll(framing.current, true, true);

    if (waiting.current !== null) follow(waiting.current.selector, waiting.current.always);
  };

  const framed = useEffectEvent(reframe);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- frames the imperative camera once React has laid a new set of sheets out
  useLayoutEffect(() => {
    if (anchors.settled) framed();
  }, [anchors]);

  const select = (key: string | null): void => {
    waiting.current = null;
    setReadOnly(null);
    post({ kind: "select", span: key === null ? null : (readSpanKey(key) ?? null) });
  };

  const send = (): void => {
    const current = edit.current;

    if (current === null || current.sent || current.queued === null) return;
    const payload = current.queued;
    current.queued = null;
    current.sent = true;
    post(
      payload.kind === "text"
        ? { kind: "text", key: current.key, value: payload.value }
        : { kind: "move", key: current.key, x: payload.x, y: payload.y },
    );
  };

  const queue = (key: Span, payload: Payload): void => {
    const current = edit.current;

    if (current === null || current.key.path !== key.path || current.key.start !== key.start)
      edit.current = { key, sent: false, queued: payload };
    else current.queued = payload;
    send();
  };

  const stopCamera = (): void => {
    flight.current += 1;
    framing.current = null;
    waiting.current = null;
    resume.current = null;
    stage.current?.removeAttribute("data-moving");
  };

  const beginTyping = (node: HTMLElement, key: string): void => {
    const span = readSpanKey(key);

    if (span === undefined) return;
    hold();
    select(key);
    setEditing({ node, words: node.innerText });
    edit.current = { key: span, sent: false, queued: null };
    node.contentEditable = "plaintext-only";
    node.style.setProperty("outline", "none", "important");
    node.focus();
    node.ownerDocument.getSelection()?.selectAllChildren(node);

    const onInput = (): void => {
      setEditing({ node, words: node.innerText });
      queue(span, {
        kind: "text",
        value: node.innerText.replaceAll("\n", " ").trimEnd(),
      });
    };

    const onKey = (event: KeyboardEvent): void => {
      event.stopPropagation();

      if (event.key !== "Escape" && event.key !== "Enter") return;
      event.preventDefault();
      node.blur();
    };

    const onDone = (): void => {
      node.removeEventListener("input", onInput);
      node.removeEventListener("keydown", onKey);
      node.removeAttribute("contenteditable");
      node.style.removeProperty("outline");
      setEditing(null);
      release();
      const back = resume.current;

      if (back === null) return;
      resume.current = null;
      framing.current = back.framing;
      fly(back.camera, false);
    };

    node.addEventListener("input", onInput);
    node.addEventListener("keydown", onKey);
    node.addEventListener("blur", onDone, { once: true });

    if (camera.current.zoom >= LEGIBLE_ZOOM) return;
    resume.current = { camera: { ...camera.current }, framing: framing.current };
    framing.current = null;
    show(worldRect(node), true, false);
  };

  const pick = (event: Event): Element | null => {
    const target = event.composedPath()[0];

    return target instanceof Element ? target : null;
  };

  const targetKey = (node: Element, deep: boolean): string | null => {
    const outermost = readVia(node)[0];

    return !deep && outermost !== undefined ? outermost : node.getAttribute("data-src");
  };

  const findFrame = (key: string): FrameBox | undefined =>
    currentDrawn()
      .sheets.flatMap((sheet) => sheet.frames)
      .find((frame) => frame.key === key);

  const onWheel = useEffectEvent((event: WheelEvent): void => {
    event.preventDefault();
    stopCamera();
    const now = camera.current;

    if (!event.ctrlKey) {
      camera.current = { ...now, x: now.x - event.deltaX, y: now.y - event.deltaY };
      apply();

      return;
    }

    const bounds = stage.current?.getBoundingClientRect() ?? new DOMRect();
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, now.zoom * Math.exp(-event.deltaY * 0.01)));
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;

    camera.current = {
      x: pointerX - ((pointerX - now.x) / now.zoom) * zoom,
      y: pointerY - ((pointerY - now.y) / now.zoom) * zoom,
      zoom,
    };
    apply();
  });

  const onPointerDown = useEffectEvent((event: PointerEvent): void => {
    const target = pick(event);

    if (editing !== null) return;
    event.preventDefault();
    event.stopPropagation();
    stage.current?.focus();

    if (event.button === 1 || event.altKey) {
      stage.current?.setPointerCapture(event.pointerId);
      setPanning(true);
      stopCamera();
      gesture.current = {
        kind: "pan",
        pointerX: event.clientX,
        pointerY: event.clientY,
        startX: camera.current.x,
        startY: camera.current.y,
      };

      return;
    }

    if (event.button !== 0) return;
    const label = target?.closest("[data-label]")?.getAttribute("data-label");
    const frame = label === undefined || label === null ? undefined : findFrame(label);

    if (frame !== undefined) {
      select(frame.key);

      if (!frame.movable) return;
      stage.current?.setPointerCapture(event.pointerId);
      hold();
      frame.node.style.zIndex = "1";
      gesture.current = {
        kind: "frame",
        frame,
        pointerX: event.clientX,
        pointerY: event.clientY,
      };

      return;
    }

    const node = target?.closest("[data-src]");
    select(node === null || node === undefined ? null : targetKey(node, event.metaKey));
  });

  const onPointerMove = useEffectEvent((event: PointerEvent): void => {
    const current = gesture.current;

    if (current === null) {
      const target = editing === null ? pick(event) : null;
      const node = target?.closest("[data-src]");
      const key = node === null || node === undefined ? null : targetKey(node, event.metaKey);
      const frame = target?.closest("[data-frame]")?.getAttribute("data-src") ?? null;

      if (key !== pointed) setPointed(key);

      if (frame !== pointedFrame) setPointedFrame(frame);

      return;
    }

    if (current.kind === "pan") {
      camera.current = {
        ...camera.current,
        x: current.startX + event.clientX - current.pointerX,
        y: current.startY + event.clientY - current.pointerY,
      };
      apply();

      return;
    }

    const frame = current.frame;
    const zoom = camera.current.zoom;
    const x = Math.round(frame.x + (event.clientX - current.pointerX) / zoom);
    const y = Math.round(frame.y + (event.clientY - current.pointerY) / zoom);

    if (held?.at.x === x && held.at.y === y) return;
    frame.node.style.left = `${String(x)}px`;
    frame.node.style.top = `${String(y)}px`;
    setHeld({ key: frame.key, at: { x, y } });
    const span = readSpanKey(frame.key);

    if (span !== undefined) queue(span, { kind: "move", x, y });
  });

  const onPointerUp = useEffectEvent((): void => {
    const current = gesture.current;
    gesture.current = null;
    setPanning(false);
    setHeld(null);

    if (current?.kind !== "frame") return;
    current.frame.node.style.removeProperty("z-index");
    release();
  });

  const onDoubleClick = useEffectEvent((event: MouseEvent): void => {
    const node = pick(event)?.closest("[data-src]");

    if (node === null || node === undefined || editing !== null) return;
    const key = node.getAttribute("data-src") ?? "";

    if (node instanceof HTMLElement && currentDrawn().texts.has(key)) {
      beginTyping(node, key);

      return;
    }

    select(key);

    if (
      [...node.childNodes].some(
        (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "",
      )
    )
      setReadOnly(node);
  });

  const onKeyDown = useEffectEvent((event: KeyboardEvent): void => {
    if (event.key === "Escape") select(null);
  });

  const onAnswer = useEffectEvent((message: Command): void => {
    switch (message.kind) {
      case "camera": {
        if (message.to !== "actual") {
          showAll(message.to === "fit" ? EVERY_FRAME : SELECTION, true, false);

          return;
        }

        const bounds = stage.current?.getBoundingClientRect();
        const now = camera.current;

        if (bounds === undefined) return;
        stopCamera();
        fly(
          {
            x: bounds.width / 2 - (bounds.width / 2 - now.x) / now.zoom,
            y: bounds.height / 2 - (bounds.height / 2 - now.y) / now.zoom,
            zoom: 1,
          },
          false,
        );

        return;
      }

      case "reveal":
        showAll(`${EVERY_FRAME}[data-sheet="${CSS.escape(message.path)}"]`, true, false);

        return;
      case "applied":
      case "refused": {
        const current = edit.current;

        if (
          current === null ||
          current.key.path !== message.from.path ||
          current.key.start !== message.from.start ||
          current.key.end !== message.from.end
        )
          return;
        current.sent = false;

        if (message.kind === "applied") current.key = message.to;
        else current.queued = null;
        send();

        return;
      }

      case "lights": {
        const always = opening.current;

        opening.current = false;

        if (message.follow === null) return;
        const selector = message.follow === "you" ? SELECTION : '[data-glow="on"]';

        requestAnimationFrame(() => requestAnimationFrame(() => follow(selector, always)));
      }
    }
  });

  useMountEffect(() => {
    const node = stage.current;

    apply();

    if (node === null) return undefined;
    const wheel = (event: WheelEvent): void => onWheel(event);
    const down = (event: PointerEvent): void => onPointerDown(event);
    const move = (event: PointerEvent): void => onPointerMove(event);
    const up = (): void => onPointerUp();
    const double = (event: MouseEvent): void => onDoubleClick(event);
    const key = (event: KeyboardEvent): void => onKeyDown(event);

    const leave = (): void => {
      setPointed(null);
      setPointedFrame(null);
    };

    const swallow = (event: Event): void => {
      if (pick(event)?.closest("[contenteditable]") === null) event.preventDefault();
      event.stopPropagation();
    };

    let size = "";

    const resized = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      const next = `${String(box?.width)}x${String(box?.height)}`;

      if (next === size) return;
      size = next;
      framed();
    });

    node.addEventListener("wheel", wheel, { passive: false });
    node.addEventListener("pointerdown", down, { capture: true });
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
    node.addEventListener("pointerleave", leave);
    node.addEventListener("dblclick", double, { capture: true });
    node.addEventListener("click", swallow, { capture: true });
    node.addEventListener("submit", swallow, { capture: true });
    node.addEventListener("keydown", key);
    resized.observe(node);
    const stop = onCommand((message) => onAnswer(message));

    return () => {
      stop();
      resized.disconnect();
      node.removeEventListener("wheel", wheel);
      node.removeEventListener("pointerdown", down, { capture: true });
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("dblclick", double, { capture: true });
      node.removeEventListener("click", swallow, { capture: true });
      node.removeEventListener("submit", swallow, { capture: true });
      node.removeEventListener("keydown", key);
    };
  });

  return (
    <div
      {...props(boardStyles.stage, panning && boardStyles.panning)}
      style={{ colorScheme: view.scheme }}
      ref={stage}
      tabIndex={0}
      role="application"
      aria-label="Design board"
    >
      <div {...props(boardStyles.world)} ref={world}>
        {sheets.flatMap((sheet) => {
          const at = placed.get(sheet.path);

          return at === undefined || sheet.error !== null
            ? []
            : [
                <div
                  key={sheet.path}
                  data-sheet-slot
                  style={{ insetInlineStart: at.x, insetBlockStart: at.y }}
                >
                  <slot name={sheet.path} />
                </div>,
              ];
        })}
        <div {...props(boardStyles.layer)}>
          {sheets.flatMap((sheet) => {
            const at = placed.get(sheet.path);

            if (at === undefined) return [];

            if (sheet.error !== null)
              return [
                <div
                  key={sheet.path}
                  role="alert"
                  {...props(text.sm, boardStyles.failure)}
                  style={{ insetInlineStart: at.x, insetBlockStart: at.y, width: FAILURE.x }}
                >
                  {`${sheet.path} could not be drawn.\n${sheet.error}`}
                </div>,
              ];

            return sheet.frames.map((frame) => (
              <FrameChrome
                key={frame.key}
                sheet={sheet.path}
                frame={frame}
                at={at}
                held={held?.key === frame.key ? held.at : null}
                room={held?.key === frame.key ? OPEN_ROOM : (rooms.get(frame.key) ?? OPEN_ROOM)}
                lit={lit === frame.key}
                pointed={pointedFrame === frame.key}
                glowing={glowing.has(frame.key)}
              />
            ));
          })}
          {pointed !== null &&
            pointed !== lit &&
            measureRings(findNodes(host, pointed), sheets, placed, held).map((rect, index) => (
              <Ring key={`hover-${String(index)}`} rect={rect} kind="hover" readOnly={false} />
            ))}
          {lit !== null &&
            measureRings(findNodes(host, lit), sheets, placed, held).map((rect, index) => (
              <Ring
                key={`you-${String(index)}`}
                rect={rect}
                kind="you"
                readOnly={readOnly !== null && readOnly === rect.node}
              />
            ))}
          {editing !== null &&
            measureRings([editing.node], sheets, placed, held).map((rect) => (
              <Ring key="edit" rect={rect} kind="edit" readOnly={false} />
            ))}
        </div>
      </div>
    </div>
  );
}
