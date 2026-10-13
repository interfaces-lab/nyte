/** What the transcript reads from its scrollport and rows besides the scroll position. */

/** Mirrors the transcript's former `paddingTop`. */
export const TRANSCRIPT_PADDING_START = 16;

/** A stuck prompt's top may sit a hair off the edge after subpixel layout. */
const STICKY_EPSILON = 2;

/** Room below the last row, above the docked composer: Cursor's clearance plus its input gap. */
export const TRANSCRIPT_PADDING_END = 114;

function setDataState(element: HTMLElement, name: string, active: boolean): void {
  const value = active ? "true" : "false";

  if (element.dataset[name] !== value) element.dataset[name] = value;
}

export function topIn(viewport: HTMLElement, element: Element): number {
  return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
}

/** Rules 16 to 18: which prompts may stick, and which one is stuck now. */
export function syncSticky(viewport: HTMLElement, content: HTMLElement, following: boolean): void {
  const prompts = content.querySelectorAll<HTMLElement>("[data-sticky-user-message]");
  const edge = viewport.getBoundingClientRect().top;
  let active: HTMLElement | undefined;

  for (const [index, prompt] of prompts.entries()) {
    const rect = prompt.getBoundingClientRect();

    const naturalTop =
      prompt.previousElementSibling?.getBoundingClientRect().bottom ??
      prompt.parentElement?.getBoundingClientRect().top ??
      rect.top;

    const rowBottom =
      prompt.closest("[data-message-id]")?.getBoundingClientRect().bottom ?? rect.bottom;

    const eligible =
      rect.height < viewport.clientHeight &&
      !(
        following &&
        index === prompts.length - 1 &&
        rowBottom - naturalTop - rect.height >= viewport.clientHeight
      );

    setDataState(prompt, "stickyDisabled", !eligible);

    if (eligible && Math.abs(rect.top - edge) <= STICKY_EPSILON) active = prompt;
  }

  for (const prompt of prompts) setDataState(prompt, "stickyActive", prompt === active);
  setDataState(viewport, "topFade", viewport.scrollTop > 0 && active === undefined);
}

/** Whether a wheel over `target` belongs to a scrollable element between it and `root`. */
export function scrollsWithin(target: EventTarget | null, root: HTMLElement): boolean {
  const node = target instanceof HTMLElement ? target : null;

  if (node === null || node === root) return false;

  const scrolls =
    node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY);

  return scrolls || scrollsWithin(node.parentElement, root);
}

/** A key press that scrolls the scrollport, or moves focus through it. */
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

/** The composer's scroll-to-bottom button: visible, reachable and announced only while shown. */
export function showScrollButton(dock: HTMLElement | null, shown: boolean): void {
  const button = dock?.querySelector<HTMLElement>("[data-slot='scroll-to-bottom']");

  if (button === null || button === undefined) return;
  setDataState(button, "scrollShown", shown);
  button.ariaHidden = shown ? null : "true";
  const control = button.querySelector("button");

  if (control !== null) control.tabIndex = shown ? 0 : -1;
}
