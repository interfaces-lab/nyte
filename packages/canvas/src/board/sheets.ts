import { Component, createElement, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { AppMessage, FrameFact } from "@nyte-ai/plugin/design/board-protocol";

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
}

export interface SheetBox {
  readonly path: string;
  readonly reads: readonly string[];
  readonly error: string | null;
  readonly frames: readonly FrameBox[];
}

/** What the designs drew. `version` moves whenever something in them may have moved or changed size. */
export interface Drawn {
  readonly sheets: readonly SheetBox[];
  readonly texts: ReadonlySet<string>;
  readonly version: number;
}

type Require = (name: string) => unknown;

interface Mounted {
  readonly container: HTMLElement;
  readonly root: Root;
  error: string | null;
}

const mounted = new Map<string, Mounted>();

const defined = new Map<Element, (require: Require) => void>();

const listeners = new Set<() => void>();

const active = new Set<string>();

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
  { readonly children?: ReactNode; readonly onError: (error: unknown) => void },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
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

/** Called by the designs' bundle as it runs, with the bundle's module loader. */
export function define(require: Require): void {
  const script = document.currentScript;

  if (script !== null) defined.get(script)?.(require);
}

/** Called by a design module that imports a stylesheet. */
export function importStyle(path: string): void {
  active.add(path);
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
  const require = await evaluate(load.code).catch((error: unknown): Require => () => {
    throw error;
  });

  current = load;
  draws += 1;
  active.clear();

  const read = load.sheets.map((sheet) => ({
    path: sheet.path,
    outcome: readSheet(require, sheet.path),
  }));

  syncStyles(load);

  for (const path of mounted.keys()) {
    if (load.sheets.some((sheet) => sheet.path === path)) continue;
    mounted.get(path)?.root.unmount();
    mounted.get(path)?.container.remove();
    mounted.delete(path);
  }

  for (const sheet of read) {
    const place = mount(sheet.path);
    const outcome = sheet.outcome;
    place.error = outcome.kind === "failed" ? outcome.message : null;

    flushSync(() =>
      place.root.render(
        outcome.kind === "failed"
          ? null
          : createElement(
              Boundary,
              {
                key: String(draws),
                onError: (error: unknown) => {
                  place.error = describe(error);
                },
              },
              createElement(outcome.Sheet),
            ),
      ),
    );
  }

  resized.disconnect();

  for (const place of mounted.values())
    for (const node of frameNodes(place.container)) {
      node.style.position = "absolute";
      node.style.left = `${String(readNumber(node, "data-x"))}px`;
      node.style.top = `${String(readNumber(node, "data-y"))}px`;
      resized.observe(node);
    }

  applyNight();
  measure();
}

function evaluate(code: string): Promise<Require> {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  const script = document.createElement("script");
  const done = Promise.withResolvers<Require>();
  defined.set(script, done.resolve);
  script.addEventListener("load", () => done.reject(new Error("The designs did not load.")));
  script.addEventListener("error", () => done.reject(new Error("The designs did not load.")));
  script.src = url;
  document.head.append(script);

  return done.promise.finally(() => {
    defined.delete(script);
    script.remove();
    URL.revokeObjectURL(url);
  });
}

// oxlint-disable-next-line nyte-code/no-one-off-boolean-helpers -- typeof narrows a default export only to Function, not to a component
function drawsSheet(value: unknown): value is ComponentType {
  return typeof value === "function";
}

function readSheet(
  require: Require,
  path: string,
):
  | { readonly kind: "drawn"; readonly Sheet: ComponentType }
  | { readonly kind: "failed"; readonly message: string } {
  try {
    const exports = require(path);

    const Sheet =
      typeof exports === "object" && exports !== null && "default" in exports
        ? exports.default
        : undefined;

    return drawsSheet(Sheet)
      ? { kind: "drawn", Sheet }
      : { kind: "failed", message: `${path} has no default export that draws its frames.` };
  } catch (error) {
    return { kind: "failed", message: describe(error) };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mount(path: string): Mounted {
  const known = mounted.get(path);

  if (known !== undefined) return known;
  const container = document.createElement("div");
  container.slot = path;
  container.dataset["sheet"] = path;
  container.style.position = "relative";
  host?.append(container);
  const place = { container, root: createRoot(container), error: null };
  mounted.set(path, place);

  return place;
}

function syncStyles(load: Load): void {
  const texts = new Map(load.styles.map((sheet) => [sheet.path, sheet.text]));

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
  return [...container.children].filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute("data-frame"),
  );
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
      if (findFact(node.getAttribute("data-src") ?? "")?.pinned !== true)
        node.setAttribute("data-theme", night ? "night" : "day");
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
                const key = node.getAttribute("data-src") ?? "";

                return {
                  key,
                  name: node.getAttribute("data-frame") ?? "",
                  x: readNumber(node, "data-x"),
                  y: readNumber(node, "data-y"),
                  width: node.offsetWidth,
                  height: node.offsetHeight,
                  node,
                  movable: findFact(key)?.movable === true,
                };
              }),
      };
    }),
    texts: new Set(load.texts),
    version: drawn.version + 1,
  };

  for (const listener of listeners) listener();
}
