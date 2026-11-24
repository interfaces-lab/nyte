import { useSyncExternalStore } from "react";

export interface PortalSlot {
  /** A ref callback for the element the slot's contents go into. */
  readonly attach: (element: HTMLElement | null) => void;
  readonly use: () => HTMLElement | null;
}

/** An element one part of the window owns, so a view elsewhere in the tree can portal into it. */
export function portalSlot(): PortalSlot {
  let slot: HTMLElement | null = null;
  const listeners = new Set<() => void>();

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);

    return () => listeners.delete(listener);
  };

  return Object.freeze({
    attach(element: HTMLElement | null) {
      if (slot === element) return;
      slot = element;

      for (const listener of listeners) listener();
    },
    use: () => useSyncExternalStore(subscribe, () => slot),
  });
}
