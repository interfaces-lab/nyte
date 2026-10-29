import type { KeyboardEvent } from "react";

const STOPS = "button:not(:disabled), a[href]";

/**
 * Moves focus through the sidebar list's visible rows, headers and controls: Up, Down, Home and
 * End step through them, Right unfolds a header or steps into it, Left folds a header or goes from
 * a chat to its header. Moving focus never opens a chat. Hover actions stay out of the order.
 */
export function moveSidebarFocus(event: KeyboardEvent<HTMLElement>): void {
  const current = event.target;

  if (
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    !(current instanceof HTMLElement)
  )
    return;

  const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(STOPS)].filter(
    (stop) => stop.closest('[data-slot="row-actions"]') === null && stop.checkVisibility(),
  );

  const index = stops.indexOf(current);

  if (index === -1) return;
  const target = focusTarget(event.key, current, stops, index);

  if (target === undefined) return;
  event.preventDefault();

  if (target === "toggle") current.click();
  else target.focus();
}

function focusTarget(
  key: string,
  current: HTMLElement,
  stops: readonly HTMLElement[],
  index: number,
): HTMLElement | "toggle" | undefined {
  const header = current.matches("[data-sidebar-header]");
  const expanded = current.getAttribute("aria-expanded") === "true";

  switch (key) {
    case "ArrowDown":
      return stops[index + 1];
    case "ArrowUp":
      return stops[index - 1];
    case "Home":
      return stops[0];
    case "End":
      return stops.at(-1);
    case "ArrowRight":
      if (!header) return undefined;

      return expanded ? stops[index + 1] : "toggle";
    case "ArrowLeft":
      if (header) return expanded ? "toggle" : undefined;

      return (
        current
          .closest("[data-sidebar-group]")
          ?.querySelector<HTMLElement>("[data-sidebar-header]") ?? undefined
      );
    default:
      return undefined;
  }
}
