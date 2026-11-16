import { stuckPrompt } from "./transcript-rows.ts";
import type { StickySpans } from "./transcript-rows.ts";

export const TRANSCRIPT_PADDING_START = 16;

export const TRANSCRIPT_PADDING_END = 114;

export const NEAR_END = 60;

function setDataState(element: HTMLElement, name: string, active: boolean): void {
  const value = active ? "true" : "false";

  if (element.dataset[name] !== value) element.dataset[name] = value;
}

export function distanceFromEnd(viewport: HTMLElement): number {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
}

export function topIn(viewport: HTMLElement, element: Element): number {
  return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
}

export function revealDistance(viewport: HTMLElement, element: Element): number {
  const box = element.getBoundingClientRect();
  const view = viewport.getBoundingClientRect();

  if (box.bottom <= view.top) return box.top - view.top;

  if (box.top < view.bottom) return 0;

  return box.height > view.height ? box.top - view.top : box.bottom - view.bottom;
}

export function syncSticky(
  viewport: HTMLElement,
  content: HTMLElement,
  handovers: StickySpans["handovers"],
): void {
  const edge = viewport.getBoundingClientRect().top;
  const height = viewport.clientHeight;
  const scrolled = viewport.scrollTop > 0;

  const prompts = Array.from(
    content.querySelectorAll<HTMLElement>("[data-sticky-user-message]"),
    (element) => {
      const rect = element.getBoundingClientRect();
      const row = element.closest<HTMLElement>("[data-index]");

      return {
        element,
        index: Number(row?.dataset.index ?? -1),
        top: rect.top - edge,
        height: rect.height,
      };
    },
  );

  const active = stuckPrompt(prompts, height, handovers);

  for (const prompt of prompts) {
    setDataState(prompt.element, "stickyDisabled", prompt.height >= height);
    setDataState(prompt.element, "stickyActive", prompt.index === active);
  }

  setDataState(viewport, "topFade", scrolled && active === undefined);
}

export function frameHasInput(viewport: HTMLElement): boolean {
  const active = document.activeElement;

  return (
    viewport.querySelector("iframe:hover") !== null ||
    (active instanceof HTMLIFrameElement && viewport.contains(active))
  );
}

export function scrollsWithin(target: EventTarget | null, root: HTMLElement): boolean {
  const node = target instanceof HTMLElement ? target : null;

  if (node === null || node === root) return false;

  const scrolls =
    node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY);

  return scrolls || scrollsWithin(node.parentElement, root);
}

export function navigates(event: KeyboardEvent): boolean {
  const editing =
    event.target instanceof HTMLElement &&
    event.target.closest("input, textarea, select, [contenteditable]") !== null;

  return (
    !event.defaultPrevented &&
    (event.key === "Tab" ||
      (!editing && /^(Arrow(Up|Down)|Page(Up|Down)|Home|End| )$/.test(event.key)))
  );
}

export function navigatesUp(event: KeyboardEvent): boolean {
  return /^(ArrowUp|PageUp|Home)$/.test(event.key) || (event.key === " " && event.shiftKey);
}

export function syncScrollButton(viewport: HTMLElement, dock: HTMLElement | null): void {
  const shown = distanceFromEnd(viewport) > NEAR_END;
  const button = dock?.querySelector<HTMLElement>("[data-slot='scroll-to-bottom']");

  if (button === null || button === undefined) return;
  setDataState(button, "scrollShown", shown);
  button.ariaHidden = shown ? null : "true";
  const control = button.querySelector("button");

  if (control !== null) control.tabIndex = shown ? 0 : -1;
}
