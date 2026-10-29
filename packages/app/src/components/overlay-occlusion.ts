const PORTAL_SELECTOR = ":scope > [data-base-ui-portal]";

const OVERLAY_SELECTOR = [
  "menu-content",
  "menu-sub-content",
  "command-popup",
  "command-backdrop",
  "context-menu-content",
  "context-menu-sub-content",
  "select-content",
  "autocomplete-content",
  "tooltip-content",
  "preview-card-content",
  "popover-popup",
  "popover-backdrop",
  "dialog-popup",
  "dialog-backdrop",
  "toast",
]
  .map((slot) => `[data-slot="${slot}"]`)
  .join(", ");

const WATCHED: MutationObserverInit = { childList: true, subtree: true, attributes: true };

interface OverlayRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const NONE: readonly OverlayRect[] = Object.freeze([]);

const inline = new Set<Element>();

const listeners = new Set<() => void>();

let rects: readonly OverlayRect[] = NONE;

let frame: number | undefined;

let observer: MutationObserver | undefined;

function portals(): readonly Element[] {
  return [...document.body.querySelectorAll(PORTAL_SELECTOR)];
}

function overlays(): readonly Element[] {
  return [
    ...inline,
    ...portals().flatMap((portal) => [...portal.querySelectorAll(OVERLAY_SELECTOR)]),
  ];
}

function painted(element: Element): boolean {
  if (!element.isConnected) return false;

  if (element.hasAttribute("data-ending-style") || element.hasAttribute("data-closed"))
    return false;
  const style = getComputedStyle(element);

  return style.visibility !== "hidden" && style.opacity !== "0";
}

function publish(elements: readonly Element[]): boolean {
  const next: OverlayRect[] = [];

  for (const element of elements) {
    if (!painted(element)) continue;
    const rect = element.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) continue;
    next.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }

  const unchanged =
    rects.length === next.length &&
    rects.every((rect, index) => {
      const other = next[index];

      return (
        other !== undefined &&
        rect.left === other.left &&
        rect.top === other.top &&
        rect.right === other.right &&
        rect.bottom === other.bottom
      );
    });

  if (unchanged) return false;
  rects = next.length === 0 ? NONE : Object.freeze(next);

  for (const listener of listeners) listener();

  return true;
}

function animating(element: Element): boolean {
  return element.getAnimations().some((animation) => animation.playState === "running");
}

function measure(): void {
  frame = undefined;
  const elements = overlays();
  const moved = publish(elements);

  if (moved || elements.some(animating)) schedule();
}

function schedule(): void {
  if (listeners.size === 0) return;
  frame ??= requestAnimationFrame(measure);
}

function observe(): void {
  if (observer === undefined) return;
  observer.disconnect();
  observer.observe(document.body, { childList: true });

  for (const target of [...portals(), ...inline]) observer.observe(target, WATCHED);
}

function changed(records: readonly MutationRecord[]): void {
  if (records.some((record) => record.target === document.body)) observe();
  schedule();
}

export function subscribeOverlayRects(listener: () => void): () => void {
  listeners.add(listener);

  if (listeners.size === 1) {
    observer = new MutationObserver(changed);
    observe();
    schedule();
  }

  return () => {
    listeners.delete(listener);

    if (listeners.size > 0) return;

    observer?.disconnect();
    observer = undefined;

    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    rects = NONE;
  };
}

export function occludes(element: Element | null): (() => void) | undefined {
  if (element === null) return undefined;
  inline.add(element);
  observe();
  schedule();

  return () => {
    inline.delete(element);
    observe();
    schedule();
  };
}

export function overlayCovers(area: OverlayRect): boolean {
  return rects.some(
    (rect) =>
      rect.left < area.right &&
      rect.right > area.left &&
      rect.top < area.bottom &&
      rect.bottom > area.top,
  );
}
