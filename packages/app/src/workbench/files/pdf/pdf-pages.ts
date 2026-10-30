import { create, props } from "@stylexjs/stylex";
import type { PDFPageProxy } from "pdfjs-dist";
import type { PageSize, PdfFile } from "./pdfjs.ts";

/** A page within half a viewport of the visible area is drawn; one within one and a half keeps the canvas it has; any other gives its canvas up. */
const RENDER_MARGIN = "50% 0px";

const RETAIN_MARGIN = "150% 0px";

const MAX_CANVAS_PIXELS = 1 << 24;

const MAX_CANVAS_SIDE = 32_767;

/** A canvas holds at most this many viewports' worth of device pixels, so a zoomed-in page stays within memory. */
const VIEWPORTS_PER_CANVAS = 8;

const styles = create({
  canvas: { display: "block", width: "100%", height: "100%" },
});

type Demand = "render" | "retain" | "release";

interface PageState {
  readonly number: number;
  readonly element: HTMLElement;
  render: boolean;
  retain: boolean;
  demand: Demand;
  queued: boolean;
  canvas: HTMLCanvasElement | undefined;
  scale: number | undefined;
  page: PDFPageProxy | undefined;
}

/** Where the view is: a page, how far past its top the view's top edge sits as a share of its height, and the horizontal scroll as a share of the scroll width. */
interface Anchor {
  readonly index: number;
  readonly fraction: number;
  readonly left: number;
}

/** A ref callback with a cleanup, which React never calls with null; its type still admits null. */
type Attach = (element: HTMLElement | null) => (() => void) | undefined;

export interface PageEvents {
  /** The current page, from 1, after each scroll. */
  readonly onPage: (page: number) => void;
  /** A page's size, each time it loads to be drawn. */
  readonly onSize: (page: number, size: PageSize) => void;
}

/** The scroll container's first child must be the page column, its children the pages in order. */
export function createPdfPages(file: PdfFile, events: PageEvents): Attach {
  const byElement = new Map<Element, PageState>();
  let viewport: HTMLElement | undefined;
  let anchor: Anchor | undefined;

  const schedule = (state: PageState): void => {
    if (state.queued) return;
    state.queued = true;
    void file.enqueue(() => paint(state));
  };

  const paint = async (state: PageState): Promise<void> => {
    state.queued = false;

    if (state.demand !== "render" || viewport === undefined) return;
    const page = await file.document.getPage(state.number);
    state.page = page;
    const size = page.getViewport({ scale: 1 });
    events.onSize(state.number, { width: size.width, height: size.height });
    const scale = rasterScale(size, state.element.clientWidth, viewport);

    if (scale === state.scale) return;
    const pixels = page.getViewport({ scale });
    const canvas = state.element.ownerDocument.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(pixels.width));
    canvas.height = Math.max(1, Math.floor(pixels.height));
    await page.render({ canvas, viewport: pixels }).promise;

    if (!state.render) {
      clear(canvas);

      return;
    }

    canvas.className = props(styles.canvas).className ?? "";

    if (state.canvas !== undefined) clear(state.canvas);
    state.element.replaceChildren(canvas);
    state.canvas = canvas;
    state.scale = scale;
  };

  const release = (state: PageState): void => {
    if (state.canvas !== undefined) clear(state.canvas);
    state.canvas = undefined;
    state.scale = undefined;
    state.page?.cleanup();
    state.page = undefined;
  };

  const update = (entries: readonly IntersectionObserverEntry[], band: "render" | "retain") => {
    for (const entry of entries) {
      const state = byElement.get(entry.target);

      if (state === undefined || entry.rootBounds === null || entry.rootBounds.height === 0)
        continue;
      state[band] = entry.isIntersecting;
      const demand = state.render ? "render" : state.retain ? "retain" : "release";

      if (demand === state.demand) continue;
      state.demand = demand;

      if (demand === "render") schedule(state);

      if (demand === "release") release(state);
    }
  };

  return (element) => {
    const column = element?.firstElementChild;

    if (element === null || column === null || column === undefined) return undefined;

    const states = Array.from(column.children)
      .filter((child) => child instanceof HTMLElement)
      .map((child, index): PageState => ({
        number: index + 1,
        element: child,
        render: false,
        retain: false,
        demand: "release",
        queued: false,
        canvas: undefined,
        scale: undefined,
        page: undefined,
      }));

    for (const state of states) byElement.set(state.element, state);
    viewport = element;

    const observers = [
      new IntersectionObserver((entries) => update(entries, "render"), {
        root: element,
        rootMargin: RENDER_MARGIN,
      }),
      new IntersectionObserver((entries) => update(entries, "retain"), {
        root: element,
        rootMargin: RETAIN_MARGIN,
      }),
    ];

    const resize = new ResizeObserver(() => {
      if (column.clientWidth === 0) return;

      if (anchor !== undefined) restore(states, anchor, element);

      for (const state of states) if (state.demand === "render") schedule(state);
    });

    for (const state of states) for (const observer of observers) observer.observe(state.element);
    resize.observe(column);

    const scroll = (): void => {
      if (element.clientHeight === 0) return;
      anchor = anchorAt(states, element);
      events.onPage(currentPage(states, element) + 1);
    };

    element.addEventListener("scroll", scroll, { passive: true });

    return () => {
      element.removeEventListener("scroll", scroll);

      for (const observer of observers) observer.disconnect();
      resize.disconnect();

      for (const state of states) {
        state.render = false;
        state.retain = false;
        state.demand = "release";
        release(state);
      }

      byElement.clear();
      viewport = undefined;
    };
  };
}

function pageAt(pages: readonly { readonly element: HTMLElement }[], y: number): number {
  let low = 0;
  let high = pages.length - 1;

  while (low < high) {
    const middle = (low + high + 1) >> 1;

    if (pages[middle].element.offsetTop <= y) low = middle;
    else high = middle - 1;
  }

  return low;
}

function currentPage(
  pages: readonly { readonly element: HTMLElement }[],
  scroller: HTMLElement,
): number {
  const top = scroller.scrollTop;
  const bottom = top + scroller.clientHeight;

  if (top < 1) return 0;

  if (scroller.scrollHeight - bottom < 1) return pages.length - 1;
  let best = pageAt(pages, top);
  let most = -Infinity;

  for (let index = best; index < pages.length; index += 1) {
    const element = pages[index].element;

    if (element.offsetTop >= bottom) break;

    const visible =
      Math.min(element.offsetTop + element.offsetHeight, bottom) - Math.max(element.offsetTop, top);

    if (visible > most) {
      best = index;
      most = visible;
    }
  }

  return best;
}

function anchorAt(
  pages: readonly { readonly element: HTMLElement }[],
  scroller: HTMLElement,
): Anchor {
  const index = pageAt(pages, scroller.scrollTop);
  const element = pages[index].element;

  return {
    index,
    fraction: (scroller.scrollTop - element.offsetTop) / Math.max(1, element.offsetHeight),
    left: scroller.scrollLeft / scroller.scrollWidth,
  };
}

function restore(
  pages: readonly { readonly element: HTMLElement }[],
  anchor: Anchor,
  scroller: HTMLElement,
): void {
  const element = pages[Math.min(anchor.index, pages.length - 1)].element;
  scroller.scrollTop = element.offsetTop + anchor.fraction * element.offsetHeight;
  scroller.scrollLeft = anchor.left * scroller.scrollWidth;
}

/** Device pixels per PDF unit. */
function rasterScale(size: PageSize, width: number, viewport: HTMLElement): number {
  const density = window.devicePixelRatio;

  const budget = Math.min(
    MAX_CANVAS_PIXELS,
    viewport.clientWidth * viewport.clientHeight * density ** 2 * VIEWPORTS_PER_CANVAS,
  );

  return Math.min(
    (width / size.width) * density,
    Math.sqrt(budget / (size.width * size.height)),
    MAX_CANVAS_SIDE / size.width,
    MAX_CANVAS_SIDE / size.height,
  );
}

function clear(canvas: HTMLCanvasElement): void {
  canvas.remove();
  canvas.width = 0;
  canvas.height = 0;
}
