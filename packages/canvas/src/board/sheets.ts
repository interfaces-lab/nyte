import { Component, createElement, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { DESIGN_ATTRIBUTE, readPageAddress } from "@nyte-ai/plugin/design/board-protocol";
import type {
  AppMessage,
  BoardSheet,
  Digest,
  FrameFact,
  SheetError,
} from "@nyte-ai/plugin/design/board-protocol";
import { post } from "./bridge.ts";
import type { Point } from "./frame-chrome.tsx";
import {
  catchEvaluation,
  locate,
  locateEvent,
  readDigests,
  readRevision,
  readSheet,
  readSheetError,
  registerModules,
} from "./modules.ts";

export type Load = Extract<AppMessage, { kind: "load" }>;

/** A frame as the board lays it out: where its file puts it in the file's sheet, and its size there. */
export interface FrameBox {
  readonly key: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly node: HTMLElement;
  readonly movable: boolean;
  readonly page: string | null;
}

export interface SheetBox {
  readonly path: string;
  readonly reads: readonly string[];
  readonly error: SheetError | null;
  readonly frames: readonly FrameBox[];
}

/** What the designs drew. `version` moves whenever something in them may have moved or changed size. */
export interface Drawn {
  readonly sheets: readonly SheetBox[];
  readonly texts: ReadonlySet<string>;
  readonly version: number;
}

interface Shown {
  readonly Sheet: ComponentType;
  readonly digests: ReadonlyMap<string, Digest>;
  readonly styles: ReadonlySet<string>;
}

interface Mounted {
  readonly container: HTMLElement;
  readonly root: Root;
  reads: readonly string[];
  signature: string;
  error: SheetError | null;
  shown: Shown | null;
}

const FRAME = `[${DESIGN_ATTRIBUTE.frame}]`;

const mounted = new Map<string, Mounted>();

const listeners = new Set<() => void>();

const moved = new WeakMap<HTMLElement, Point>();

const resized = new ResizeObserver(() => measure());

let host: HTMLElement | null = null;

let current: Load | null = null;

let pending: Load | null = null;

let holding = false;

let drawing = false;

let night = false;

let drawn: Drawn = { sheets: [], texts: new Set(), version: 0 };

let draws = 0;

class Boundary extends Component<
  {
    readonly children?: ReactNode;
    readonly onError: (error: unknown) => void;
    readonly onDrawn: () => void;
  },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override componentDidMount(): void {
    if (!this.state.failed) this.props.onDrawn();
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Where the designs draw: light-DOM children of the board's host, each slotted into its place on the board. */
export function mountSheets(into: HTMLElement): void {
  host = into;
}

export function catchErrors(): void {
  window.addEventListener("error", (event) => {
    if (catchEvaluation(event)) return;
    fail(readSheetError(event.error ?? event.message, locateEvent(event)));
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;

    fail(readSheetError(reason, locate(reason)));
  });
}

/** Draws `load`, or keeps it for later while the person types in a design or carries a frame. */
export function receive(load: Load): void {
  if (holding || drawing) {
    pending = load;

    return;
  }

  void show(load);
}

/** Stops drawing new loads until `release`, so a node being typed into or carried stays the one on screen. */
export function hold(): void {
  holding = true;
}

export function release(): void {
  holding = false;
  const next = pending;

  if (next === null || drawing) return;
  pending = null;
  void show(next);
}

export function setNight(next: boolean): void {
  night = next;
  applyNight();
}

export function currentDrawn(): Drawn {
  return drawn;
}

export function findBase(node: Node, path: string): Digest | undefined {
  return [...mounted.values()]
    .find((place) => place.container.contains(node))
    ?.shown?.digests.get(path);
}

export function placeFrame(node: HTMLElement, at: Point | null): void {
  if (at === null) moved.delete(node);
  else moved.set(node, at);
  placeNode(node);
  measure();
}

export function useDrawn(): Drawn {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    () => drawn,
  );
}

async function show(load: Load): Promise<void> {
  drawing = true;

  try {
    await draw(load);
  } finally {
    drawing = false;
  }

  const next = pending;

  if (next === null || holding) return;
  pending = null;
  await show(next);
}

async function draw(load: Load): Promise<void> {
  await registerModules(load.modules);
  current = load;

  for (const entry of mounted) {
    if (load.sheets.some((sheet) => sheet.path === entry[0])) continue;
    entry[1].root.unmount();
    entry[1].container.remove();
    mounted.delete(entry[0]);
  }

  for (const sheet of load.sheets) {
    const place = mount(sheet);
    const signature = JSON.stringify(sheet.reads.map((path) => [path, readRevision(path)]));

    if (place.signature === signature) continue;
    place.signature = signature;
    drawSheet(place, readSheet(sheet.path));
  }

  resized.disconnect();

  for (const place of mounted.values())
    for (const node of frameNodes(place.container)) {
      node.style.position = "absolute";
      placeNode(node);
      resized.observe(node);
    }

  syncStyles(load);
  applyNight();
  measure();
  report();
}

function drawSheet(place: Mounted, outcome: ReturnType<typeof readSheet>): void {
  if (outcome.kind === "failed") {
    place.error = outcome.error;

    return;
  }

  const last = place.shown;
  place.error = null;
  render(place, {
    Sheet: outcome.Sheet,
    digests: readDigests(place.reads),
    styles: outcome.styles,
  });

  if (place.error === null || last === null) return;
  const error = place.error;
  render(place, last);
  place.error = error;
}

function render(place: Mounted, shown: Shown): void {
  draws += 1;
  flushSync(() =>
    place.root.render(
      createElement(
        Boundary,
        {
          key: String(draws),
          onError: (error: unknown) => {
            place.error = readSheetError(error, locate(error));

            if (drawing) return;
            measure();
            report();
          },
          onDrawn: () => {
            place.shown = shown;
          },
        },
        createElement(shown.Sheet),
      ),
    ),
  );
}

function fail(error: SheetError): void {
  const path = error.path;

  if (path === null) return;
  const failed = [...mounted.values()].filter((place) => place.reads.includes(path));

  if (failed.length === 0) return;

  for (const place of failed) place.error = error;
  measure();
  report();
}

function report(): void {
  const load = current;

  if (load === null) return;
  post({
    kind: "drawn",
    build: load.build,
    sheets: load.sheets
      .slice(0, 4096)
      .map((sheet) => ({ path: sheet.path, error: mounted.get(sheet.path)?.error ?? null })),
  });
}

function mount(sheet: BoardSheet): Mounted {
  const known = mounted.get(sheet.path);

  if (known !== undefined) {
    known.reads = sheet.reads;

    return known;
  }

  const container = document.createElement("div");
  container.slot = sheet.path;
  container.dataset["sheet"] = sheet.path;
  container.style.position = "relative";
  host?.append(container);

  const place: Mounted = {
    container,
    root: createRoot(container),
    reads: sheet.reads,
    signature: "",
    error: null,
    shown: null,
  };

  mounted.set(sheet.path, place);

  return place;
}

function placeNode(node: HTMLElement): void {
  const at = moved.get(node) ?? {
    x: readNumber(node, DESIGN_ATTRIBUTE.x),
    y: readNumber(node, DESIGN_ATTRIBUTE.y),
  };

  node.style.left = `${String(at.x)}px`;
  node.style.top = `${String(at.y)}px`;
}

function syncStyles(load: Load): void {
  const texts = new Map(load.styles.map((sheet) => [sheet.path, sheet.text]));

  const active = new Set(
    [...mounted.values()].flatMap((place) => [...(place.shown?.styles ?? [])]),
  );

  const shown = new Map(
    [...document.head.querySelectorAll("style[data-design]")].map((node) => [
      node.getAttribute("data-design") ?? "",
      node,
    ]),
  );

  for (const entry of shown) if (!active.has(entry[0])) entry[1].remove();

  for (const path of active) {
    const node = shown.get(path) ?? document.head.appendChild(document.createElement("style"));
    node.setAttribute("data-design", path);
    const text = texts.get(path) ?? "";

    if (node.textContent !== text) node.textContent = text;
    document.head.append(node);
  }
}

function frameNodes(container: HTMLElement): readonly HTMLElement[] {
  return [...container.querySelectorAll(FRAME)].filter((node): node is HTMLElement => {
    const outer = node.parentElement?.closest(FRAME);

    return (
      node instanceof HTMLElement &&
      (outer === null || outer === undefined || !container.contains(outer))
    );
  });
}

function readNumber(node: Element, name: string): number {
  const value = Number(node.getAttribute(name));

  return Number.isFinite(value) ? Math.round(value) : 0;
}

function findFact(key: string): FrameFact | undefined {
  return current?.frames.find((fact) => fact.key === key);
}

function applyNight(): void {
  for (const place of mounted.values())
    for (const node of frameNodes(place.container))
      if (findFact(node.getAttribute(DESIGN_ATTRIBUTE.source) ?? "")?.pinned !== true)
        node.setAttribute(DESIGN_ATTRIBUTE.theme, night ? "night" : "day");
}

function measure(): void {
  const load = current;

  if (load === null) return;

  drawn = {
    sheets: load.sheets.map((sheet) => {
      const place = mounted.get(sheet.path);

      return {
        path: sheet.path,
        reads: sheet.reads,
        error: place?.error ?? null,
        frames:
          place === undefined
            ? []
            : frameNodes(place.container).map((node) => {
                const key = node.getAttribute(DESIGN_ATTRIBUTE.source) ?? "";
                const at = moved.get(node);

                return {
                  key,
                  name: node.getAttribute(DESIGN_ATTRIBUTE.frame) ?? "",
                  x: at?.x ?? readNumber(node, DESIGN_ATTRIBUTE.x),
                  y: at?.y ?? readNumber(node, DESIGN_ATTRIBUTE.y),
                  width: node.offsetWidth,
                  height: node.offsetHeight,
                  node,
                  movable: findFact(key)?.movable === true,
                  page: readPageAddress(node.getAttribute(DESIGN_ATTRIBUTE.page)) ?? null,
                };
              }),
      };
    }),
    texts: new Set(load.texts),
    version: drawn.version + 1,
  };

  for (const listener of listeners) listener();
}
