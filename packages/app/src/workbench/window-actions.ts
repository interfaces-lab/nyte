import { useSyncExternalStore } from "react";

let slot: HTMLElement | null = null;

const listeners = new Set<() => void>();

/** Where the title bar holds the main area's own controls, so the view that owns them can portal them there. */
export function attachWindowActions(element: HTMLElement | null): void {
  if (slot === element) return;
  slot = element;

  for (const listener of listeners) listener();
}

export function useWindowActionsSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    () => slot,
  );
}
