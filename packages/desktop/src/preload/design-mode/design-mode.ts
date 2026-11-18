import { BROWSER_DESIGN_VIEW_KEYS } from "@nyte-ai/app/contract/bridge.ts";
import type { BrowserDesign } from "@nyte-ai/app/contract/bridge.ts";
import type { DesignMainMessage } from "../../shared/browser-page.ts";
import type { DesignPageMessage } from "../../shared/ipc-inputs.ts";
import { editsText } from "../edits-text.ts";
import { contrastMarks, inspectElement, pageTokens } from "./inspect.ts";
import type { ContrastMark, Token } from "./inspect.ts";
import { createLabel, LABEL_CSS } from "./label.ts";
import type { Label } from "./label.ts";
import { measureSpacing, redlines, trackMap } from "./measure.ts";
import type { Redline, TrackMap } from "./measure.ts";
import { ACCENT_RGB, glideOutline, paintScene, RULER_SIZE } from "./paint.ts";
import type { Guide, Measured, Scene } from "./paint.ts";
import {
  DRAG_THRESHOLD,
  MIN_AREA,
  boxBetween,
  clipBox,
  elementBox,
  coveredOutlines,
  describeElement,
  elementCrop,
  excerptText,
  labelParts,
  meaningfulAncestor,
  meaningfulElement,
  measureOutline,
  visibleOutlines,
  worthSelecting,
} from "./picker.ts";
import type { Box, Outline, Point } from "./picker.ts";

const XRAY_LIMIT = 600;

const TRACK_LIMIT = 120;

const GUIDE_REACH = 4;

const ALIGNED_PX = 0.05;

const VIEW_KEYS = new Map(Object.entries(BROWSER_DESIGN_VIEW_KEYS));

const POINTER_EVENTS = [
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "pointerover",
  "pointerout",
  "pointerleave",
  "mousedown",
  "mousemove",
  "mouseup",
  "mouseover",
  "mouseout",
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
] as const;

const OVERLAY_CSS = `
canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
${LABEL_CSS}`;

type PagePick = Extract<DesignPageMessage, { kind: "pick" }>;

type Gesture =
  | { readonly kind: "pick"; readonly origin: Point; dragging: boolean }
  | {
      readonly kind: "guide";
      readonly index: number;
      readonly fromRuler: boolean;
      readonly origin: Point;
      dragging: boolean;
    };

interface Grab {
  readonly guide: Guide;
  readonly index: number | undefined;
  readonly fromRuler: boolean;
}

interface Layers {
  readonly xray: readonly Outline[];
  readonly selectable: readonly Outline[];
  readonly tracks: TrackMap | undefined;
  readonly contrast: readonly ContrastMark[];
}

interface Overlay {
  readonly host: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly label: Label;
  readonly mutations: MutationObserver;
  readonly focused: Element | null;
}

export interface DesignMode {
  receive(message: DesignMainMessage): void;
}

export function designMode(send: (message: DesignPageMessage) => void): DesignMode {
  let design: BrowserDesign | undefined;
  let overlay: Overlay | undefined;
  let path: readonly Element[] = [];
  let marquee: Box | undefined;
  let gesture: Gesture | undefined;
  let pointer: Point | undefined;
  let option = false;
  let guides: readonly Guide[] = [];
  let tokens: readonly Token[] | undefined;
  let layers: Layers | undefined;
  let glide: { readonly current: Outline; readonly target: Outline } | undefined;
  let pending: string | undefined;
  let raise = false;
  let frame = 0;
  let painted = 0;
  const consumed = new Set<string>();

  for (const type of POINTER_EVENTS) window.addEventListener(type, onPointer, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
  window.addEventListener("blur", () => {
    option = false;
    consumed.clear();
    schedule();
  });

  return {
    receive(message) {
      if (message.kind === "captured") {
        if (message.id === pending) pending = undefined;
        schedule();

        return;
      }

      const before = design;

      design = message.design;

      if (!design.on) {
        unmount();

        return;
      }

      if (before?.views !== design.views) layers = undefined;

      overlay ??= mount();
      schedule();
    },
  };

  function onPointer(event: Event): void {
    if (overlay === undefined || !event.isTrusted) return;
    const host = overlay.host;

    if (
      event instanceof MouseEvent &&
      (event.clientX >= host.clientWidth || event.clientY >= host.clientHeight)
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();

    if (!(event instanceof PointerEvent)) return;

    if (event.type === "pointerdown") press(event, host);
    else if (event.type === "pointermove") move(event);
    else if (event.type === "pointerup") release(event);
    else if (event.type === "pointercancel") cancel();
    else if (event.type === "pointerleave" && event.relatedTarget === null) leave();
  }

  function press(event: PointerEvent, host: HTMLElement): void {
    if (event.button !== 0) return;
    host.setPointerCapture(event.pointerId);
    const at = { x: event.clientX, y: event.clientY };
    const grab = grabAt(at);

    if (grab === undefined) {
      gesture = { kind: "pick", origin: at, dragging: false };

      return;
    }

    path = [];

    if (grab.index === undefined) guides = [...guides, grab.guide];

    gesture = {
      kind: "guide",
      index: grab.index ?? guides.length - 1,
      fromRuler: grab.fromRuler,
      origin: at,
      dragging: grab.index === undefined,
    };
    schedule();
  }

  function move(event: PointerEvent): void {
    const at = { x: event.clientX, y: event.clientY };
    const current = gesture;

    pointer = at;
    option = event.altKey;
    schedule();

    if (current === undefined) {
      if (grabAt(at) === undefined) hoverAt(at);
      else path = [];

      return;
    }

    if (
      !current.dragging &&
      Math.hypot(at.x - current.origin.x, at.y - current.origin.y) >= DRAG_THRESHOLD
    ) {
      current.dragging = true;
    }

    if (!current.dragging) return;

    if (current.kind === "guide") dragGuide(current.index, at);
    else marquee = boxBetween(current.origin, at);
  }

  function release(event: PointerEvent): void {
    const current = gesture;
    const at = { x: event.clientX, y: event.clientY };

    gesture = undefined;
    schedule();

    if (current === undefined || overlay === undefined) return;

    if (current.kind === "guide") {
      const viewport = viewportSize(overlay.host);
      const outside = at.x < 0 || at.y < 0 || at.x > viewport.width || at.y > viewport.height;

      if ((!current.dragging && current.fromRuler) || (current.dragging && outside)) {
        guides = guides.filter((_, index) => index !== current.index);
      }

      return;
    }

    if (!current.dragging) {
      pickAt(at, overlay);

      return;
    }

    marquee = undefined;
    pickArea(boxBetween(current.origin, at), overlay);
  }

  function cancel(): void {
    gesture = undefined;
    marquee = undefined;
    schedule();
  }

  function leave(): void {
    pointer = undefined;

    if (gesture === undefined) path = [];
    schedule();
  }

  function onKey(event: KeyboardEvent): void {
    if (!event.isTrusted) return;

    if (event.type === "keyup" && consumed.delete(event.code)) stop(event);

    if (design === undefined || !design.on) return;

    if (option !== event.altKey) {
      option = event.altKey;
      schedule();
    }

    if (event.type !== "keydown" || event.repeat || !handleKey(event, design)) return;
    consumed.add(event.code);
    stop(event);
    schedule();
  }

  function handleKey(event: KeyboardEvent, current: BrowserDesign): boolean {
    const modified = event.metaKey || event.ctrlKey || event.altKey;
    const view = event.shiftKey && !modified ? VIEW_KEYS.get(event.code) : undefined;

    if (view !== undefined && !editsText(event)) {
      send({ kind: "view", view, shown: !current.views[view] });

      return true;
    }

    if (event.key === "Escape" && !modified && !event.shiftKey) {
      if (marquee === undefined) send({ kind: "off" });
      else {
        gesture = undefined;
        marquee = undefined;
      }

      return true;
    }

    const top = path.at(-1);

    if (top === undefined || modified || event.shiftKey) return false;

    if (event.key === "ArrowUp") {
      const parent = meaningfulAncestor(top, document.documentElement);

      if (parent !== undefined) path = [...path, parent];

      return true;
    }

    if (event.key === "ArrowDown") {
      if (path.length > 1) path = path.slice(0, -1);

      return true;
    }

    return false;
  }

  function hitAt(at: Point): Element | undefined {
    const root = document.documentElement;

    const hit = document
      .elementsFromPoint(at.x, at.y)
      .find((element) => element !== overlay?.host && element !== root && root.contains(element));

    return hit === undefined ? undefined : meaningfulElement(hit, root);
  }

  function hoverAt(at: Point): void {
    const hit = hitAt(at);

    if (hit === undefined) path = [];
    else if (path[0] !== hit) path = [hit];
  }

  function pickAt(at: Point, current: Overlay): void {
    const hit = hitAt(at);

    if (hit === undefined || pending !== undefined) return;
    const element = path[0] === hit ? (path.at(-1) ?? hit) : hit;
    const facts = describeElement(element, document.documentElement);

    sendPick(
      {
        kind: "pick",
        selector: facts.selector,
        text: excerptText(facts),
        crop: clipBox(toViewport(elementCrop(facts.bounds)), viewportBox(current.host)),
      },
      current,
    );
  }

  function pickArea(area: Box, current: Overlay): void {
    const clipped = clipBox(area, viewportBox(current.host));

    if (clipped.width < MIN_AREA || clipped.height < MIN_AREA || pending !== undefined) return;
    const root = document.documentElement;
    const origin = pageOrigin();
    const center = { x: clipped.x + clipped.width / 2, y: clipped.y + clipped.height / 2 };

    const anchor = describeElement(hitAt(center) ?? root, root);

    sendPick(
      {
        kind: "pick",
        selector: anchor.selector,
        text: excerptText(anchor),
        region: { ...clipped, x: clipped.x - origin.x, y: clipped.y - origin.y },
        crop: clipped,
      },
      current,
    );
  }

  function sendPick(pick: Omit<PagePick, "id">, current: Overlay): void {
    const id = crypto.randomUUID();

    pending = id;
    path = [];
    glide = undefined;
    styleHost(current.host, "crosshair", true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (overlay === current) send({ ...pick, id });
      }),
    );
  }

  function grabAt(at: Point): Grab | undefined {
    if (design?.views.rulers !== true) return undefined;

    if (at.x < RULER_SIZE && at.y < RULER_SIZE) return undefined;
    const origin = pageOrigin();
    const axis = at.y < RULER_SIZE ? "x" : at.x < RULER_SIZE ? "y" : undefined;

    const near = guides.find(
      (guide) =>
        (axis === undefined || guide.axis === axis) &&
        Math.abs(guide.at + origin[guide.axis] - at[guide.axis]) <= GUIDE_REACH,
    );

    if (near !== undefined) {
      return { guide: near, index: guides.indexOf(near), fromRuler: axis !== undefined };
    }

    if (axis === undefined) return undefined;

    return {
      guide: { axis, at: Math.round(at[axis] - origin[axis]) },
      index: undefined,
      fromRuler: true,
    };
  }

  function dragGuide(index: number, at: Point): void {
    const root = document.documentElement;
    const origin = pageOrigin();
    const hit = hitAt(at);
    const box = hit === undefined ? undefined : elementBox(hit, root);

    guides = guides.map((guide, each) => {
      if (each !== index) return guide;
      const position = at[guide.axis] - origin[guide.axis];

      const edge = (box === undefined ? [] : boxEdges(box, guide.axis)).find(
        (candidate) => Math.abs(candidate - position) <= GUIDE_REACH,
      );

      return { ...guide, at: edge ?? Math.round(position) };
    });
  }

  function mount(): Overlay {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });
    const sheet = new CSSStyleSheet();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const label = createLabel();
    const focused = document.activeElement;

    if (context === null) throw new Error("Design Mode needs a 2D canvas.");
    sheet.replaceSync(OVERLAY_CSS);
    shadow.adoptedStyleSheets = [sheet];
    shadow.append(canvas, label.element);
    styleHost(host, "crosshair", pending !== undefined);
    host.addEventListener("wheel", scrollUnder, { passive: false });
    attach(host, modalOr(document.documentElement));
    host.focus({ preventScroll: true });
    window.addEventListener("scroll", invalidate, { capture: true, passive: true });
    window.addEventListener("resize", invalidate);
    document.addEventListener("load", invalidate, true);
    document.addEventListener("toggle", lift, true);

    const mutations = new MutationObserver((records) => {
      const page = records.filter((record) => record.target !== host);

      if (page.some((record) => record.attributeName === "open")) raise = true;

      if (page.length > 0) layers = undefined;

      if (
        page.some(
          (record) =>
            record.type === "attributes" &&
            (record.target === document.documentElement || record.target === document.body),
        )
      ) {
        tokens = undefined;
      }

      schedule();
    });

    mutations.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    return { host, canvas, context, label, mutations, focused };
  }

  function unmount(): void {
    if (overlay !== undefined) {
      overlay.mutations.disconnect();
      overlay.host.remove();
      window.removeEventListener("scroll", invalidate, { capture: true });
      window.removeEventListener("resize", invalidate);
      document.removeEventListener("load", invalidate, true);
      document.removeEventListener("toggle", lift, true);

      if (overlay.focused instanceof HTMLElement && overlay.focused.isConnected) {
        overlay.focused.focus({ preventScroll: true });
      }
    }

    cancelAnimationFrame(frame);
    overlay = undefined;
    frame = 0;
    path = [];
    marquee = undefined;
    gesture = undefined;
    pointer = undefined;
    guides = [];
    tokens = undefined;
    layers = undefined;
    glide = undefined;
    pending = undefined;
  }

  function lift(event: Event): void {
    if (event.target === overlay?.host) return;
    raise = true;
    schedule();
  }

  function invalidate(): void {
    layers = undefined;

    if (pointer !== undefined && gesture === undefined) hoverAt(pointer);
    schedule();
  }

  function scrollUnder(event: WheelEvent): void {
    if (event.defaultPrevented) return;
    event.preventDefault();

    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1;

    const hit = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((element) => element !== overlay?.host);

    scrollAlong(hit, "x", event.deltaX * unit);
    scrollAlong(hit, "y", event.deltaY * unit);
  }

  function schedule(): void {
    if (overlay !== undefined && frame === 0) frame = requestAnimationFrame(render);
  }

  function render(now: number): void {
    frame = 0;
    const current = overlay;

    if (current === undefined || design === undefined) return;
    const host = current.host;
    const root = document.documentElement;

    const parent = modalOr(root);

    if (host.parentElement !== parent) {
      attach(host, parent);
      host.focus({ preventScroll: true });
    }

    if (raise || !host.matches(":popover-open")) {
      if (host.matches(":popover-open")) host.hidePopover();
      show(host);
      raise = false;
    }

    const viewport = viewportSize(host);
    const ratio = window.devicePixelRatio;
    const origin = pageOrigin();
    const view = { x: -origin.x, y: -origin.y, ...viewport };
    const views = design.views;

    layers ??= readLayers(host, root, view, design);

    if (path.some((element) => !element.isConnected)) path = [];
    const hovered = marquee === undefined && gesture?.kind !== "guide" ? path.at(-1) : undefined;
    const marked = hovered === undefined ? undefined : elementBox(hovered, root);
    const tracks = layers.tracks;
    const spacing = hovered === undefined ? undefined : measureSpacing(hovered, root);
    const measured = option && hovered !== undefined ? measureFrom(root, hovered) : undefined;

    const toViewportLine = (line: Redline): Redline => ({
      ...line,
      from: { x: line.from.x + origin.x, y: line.from.y + origin.y },
      to: { x: line.to.x + origin.x, y: line.to.y + origin.y },
    });

    const scene: Scene = {
      xray: layers.xray.map(toViewport),
      covered:
        views.xray && marquee !== undefined
          ? coveredOutlines(layers.selectable, {
              ...marquee,
              x: marquee.x - origin.x,
              y: marquee.y - origin.y,
            }).map(toViewport)
          : [],
      marquee,
      tracks:
        tracks === undefined
          ? undefined
          : {
              containers: tracks.containers.map(toViewport),
              lines: tracks.lines.map(toViewportLine),
              gaps: tracks.gaps.map(toViewport),
            },
      spacing:
        spacing === undefined
          ? undefined
          : {
              margin: spacing.margin.map(toViewport),
              padding: spacing.padding.map(toViewport),
              gaps: spacing.gaps.map(toViewport),
            },
      measure:
        measured === undefined
          ? undefined
          : {
              from: toViewport(measured.from),
              to: toViewport(measured.to),
              lines: measured.lines.map(toViewportLine),
            },
      contrast: layers.contrast.map((mark) => ({ ...mark, box: toViewport(mark.box) })),
      rulers: views.rulers
        ? {
            origin,
            cursor: pointer,
            extent: marked === undefined ? undefined : toViewport(marked),
            guides: guides.map((guide) => ({
              ...guide,
              at: guide.at + origin[guide.axis],
              aligned:
                marked !== undefined &&
                boxEdges(marked, guide.axis).some(
                  (edge) => Math.abs(edge - guide.at) <= ALIGNED_PX,
                ),
            })),
          }
        : undefined,
    };

    const target = hovered === undefined ? undefined : toViewport(measureOutline(hovered, root));

    glide =
      target === undefined
        ? undefined
        : {
            current:
              glide === undefined ? target : glideOutline(glide.current, target, now - painted),
            target,
          };
    painted = now;
    const pixelWidth = Math.round(viewport.width * ratio);
    const pixelHeight = Math.round(viewport.height * ratio);

    if (current.canvas.width !== pixelWidth || current.canvas.height !== pixelHeight) {
      current.canvas.width = pixelWidth;
      current.canvas.height = pixelHeight;
    }

    paintScene(current.context, { ratio, ...viewport }, scene, glide?.current);
    const grip = pointer === undefined || gesture?.kind === "pick" ? undefined : grabAt(pointer);

    styleHost(
      host,
      grip === undefined ? "crosshair" : grip.guide.axis === "x" ? "col-resize" : "row-resize",
      pending !== undefined,
    );

    if (hovered === undefined || target === undefined) current.label.hide();
    else {
      tokens ??= pageTokens(root);
      current.label.show(
        {
          box: target,
          anchorX: pointer?.x,
          parts: labelParts(hovered),
          inspection: inspectElement(hovered, root, tokens),
        },
        viewport,
      );
    }

    if (glide !== undefined && glide.current !== glide.target) schedule();
  }

  function toViewport<Value extends Box>(box: Value): Value {
    const origin = pageOrigin();

    return { ...box, x: box.x + origin.x, y: box.y + origin.y };
  }
}

function styleHost(host: HTMLElement, cursor: string, hidden: boolean): void {
  const style = [
    "all: initial",
    "position: fixed",
    "inset: 0",
    "width: 100%",
    "height: 100%",
    "max-width: none",
    "max-height: none",
    "margin: 0",
    "padding: 0",
    "border: 0",
    "background: transparent",
    "overflow: hidden",
    "display: block",
    "pointer-events: auto",
    "outline: none",
    "transition: none",
    "animation: none",
    `cursor: ${cursor}`,
    `opacity: ${hidden ? "0" : "1"}`,
    `box-shadow: inset 0 0 0 2px rgb(${ACCENT_RGB})`,
  ]
    .map((rule) => `${rule} !important`)
    .join("; ");

  if (host.getAttribute("style") !== style) host.setAttribute("style", style);
}

function readLayers(host: Element, root: Element, view: Box, design: BrowserDesign): Layers {
  const views = design.views;
  const scans = views.xray || views.grid || views.contrast;

  const elements = scans
    ? [...root.querySelectorAll("*")].filter((element) => element !== host)
    : [];

  return {
    xray: views.xray ? visibleOutlines(elements, root, view, XRAY_LIMIT) : [],
    selectable: views.xray
      ? visibleOutlines(elements.filter(worthSelecting), root, view, XRAY_LIMIT)
      : [],
    tracks: views.grid ? trackMap(elements, root, view, TRACK_LIMIT) : undefined,
    contrast: views.contrast
      ? contrastMarks(elements, root, view).filter((mark) => mark.contrast.level === "fail")
      : [],
  };
}

function pageOrigin(): Point {
  const rect = document.documentElement.getBoundingClientRect();

  return { x: rect.left, y: rect.top };
}

function viewportSize(host: HTMLElement) {
  return { width: host.clientWidth, height: host.clientHeight };
}

function viewportBox(host: HTMLElement): Box {
  return { x: 0, y: 0, ...viewportSize(host) };
}

function attach(host: HTMLElement, parent: Element): void {
  parent.append(host);
  show(host);
}

function modalOr(root: Element): Element {
  return document.querySelector("dialog:modal") ?? root;
}

function show(host: HTMLElement): void {
  host.popover = "manual";
  host.tabIndex = -1;
  host.showPopover();
}

function measureFrom(root: Element, element: Element): Measured | undefined {
  const parent = element.parentElement;

  if (parent === null || !root.contains(parent)) return undefined;
  const from = elementBox(element, root);
  const to = elementBox(parent, root);

  return { from, to, lines: redlines(from, to) };
}

function boxEdges(box: Box, axis: Guide["axis"]): readonly number[] {
  return axis === "x" ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
}

function scrollAlong(start: Element | undefined, axis: "x" | "y", delta: number): void {
  if (delta === 0) return;
  const page = document.scrollingElement ?? document.documentElement;

  for (
    let node = start ?? null;
    node !== null && node !== page && node !== document.documentElement;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);

    if (!/auto|scroll|overlay/.test(axis === "x" ? style.overflowX : style.overflowY)) continue;
    const position = axis === "x" ? node.scrollLeft : node.scrollTop;

    const room =
      axis === "x" ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;

    if (room < 1) continue;
    const reversed = axis === "x" && style.direction === "rtl";
    const low = reversed ? -room : 0;
    const high = reversed ? 0 : room;

    if (delta > 0 ? position < high - 0.5 : position > low + 0.5) {
      node.scrollBy(scrollStep(axis, delta));

      return;
    }

    if ((axis === "x" ? style.overscrollBehaviorX : style.overscrollBehaviorY) !== "auto") return;
  }

  window.scrollBy(scrollStep(axis, delta));
}

function scrollStep(axis: "x" | "y", delta: number): ScrollToOptions {
  return axis === "x" ? { left: delta, behavior: "instant" } : { top: delta, behavior: "instant" };
}

function stop(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}
