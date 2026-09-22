/**
 * Native `WebContentsView` pages composite above the whole renderer, so no
 * z-index can put a menu or a dialog over a browser panel. Floating surfaces
 * register their element here, and a native surface hides itself while a
 * registered rectangle covers it.
 *
 * VS Code solves the same problem by sniffing the DOM for known overlay
 * classes; registration is exact instead, because this app owns every popup it
 * renders. The cost is that a new floating surface must register, which is why
 * registration lives in the shared primitives rather than in feature code.
 *
 * Rectangles are remeasured every frame while a native surface is listening:
 * popups move with their anchor and with their open animation, and a stale
 * rectangle would either hide a page for nothing or leave it covering a popup.
 * With no listener there is nothing to occlude, so nothing is measured.
 */

export interface OverlayRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const NONE: readonly OverlayRect[] = Object.freeze([]);

const elements = new Set<Element>();

const listeners = new Set<() => void>();

let rects: readonly OverlayRect[] = NONE;

let frame: number | undefined;

function sameRects(a: readonly OverlayRect[], b: readonly OverlayRect[]): boolean {
  return (
    a.length === b.length &&
    a.every((rect, index) => {
      const other = b[index];

      return (
        other !== undefined &&
        rect.left === other.left &&
        rect.top === other.top &&
        rect.right === other.right &&
        rect.bottom === other.bottom
      );
    })
  );
}

/**
 * Base UI keeps a popup mounted through its exit transition. A closing popup is
 * on its way out and must not keep a page hidden, and neither must an element
 * that is mounted but not painted.
 */
function isPainted(element: Element): boolean {
  if (!element.isConnected) return false;

  if (element.hasAttribute("data-ending-style") || element.hasAttribute("data-closed"))
    return false;
  const style = getComputedStyle(element);

  return style.visibility !== "hidden" && style.opacity !== "0";
}

function publish(): void {
  const next: OverlayRect[] = [];

  for (const element of elements) {
    if (!isPainted(element)) continue;
    const rect = element.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) continue;
    next.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }

  if (sameRects(rects, next)) return;
  rects = next.length === 0 ? NONE : Object.freeze(next);

  for (const listener of listeners) listener();
}

function measure(): void {
  frame = undefined;
  publish();

  if (listeners.size > 0 && elements.size > 0) frame = requestAnimationFrame(measure);
}

function schedule(): void {
  if (listeners.size === 0 || elements.size === 0) return;
  frame ??= requestAnimationFrame(measure);
}

/** Track an overlay element for as long as it stays mounted. */
export function registerOverlay(element: Element): () => void {
  elements.add(element);
  // Publishing here rather than a frame later keeps the popup's first painted
  // frame from landing behind a page that has not been told to step aside yet.
  publish();
  schedule();

  return () => {
    elements.delete(element);
    publish();

    if (elements.size > 0) return;

    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };
}

/** Ref callback for a popup, backdrop, or any other element that must stay visible. */
export function overlayRef(node: Element | null): (() => void) | undefined {
  return node === null ? undefined : registerOverlay(node);
}

export function getOverlayRects(): readonly OverlayRect[] {
  return rects;
}

/** Only a native surface subscribes, and only then is anything measured. */
export function subscribeOverlayRects(listener: () => void): () => void {
  listeners.add(listener);

  if (listeners.size === 1) {
    publish();
    schedule();
  }

  return () => {
    listeners.delete(listener);

    if (listeners.size > 0) return;

    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    rects = NONE;
  };
}

/** Whether any overlay covers part of this area, in viewport coordinates. */
export function overlayCovers(area: OverlayRect): boolean {
  return rects.some(
    (rect) =>
      rect.left < area.right &&
      rect.right > area.left &&
      rect.top < area.bottom &&
      rect.bottom > area.top,
  );
}
