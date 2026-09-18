// oxlint-disable-next-line no-restricted-imports -- the hatch itself
import { useEffect } from "react";

/**
 * The escape hatch for mount-shaped work: subscribing to an external system,
 * starting a session, or aborting on unmount. Anything driven by a changing
 * value is derived state, an event, or a query — not a mount.
 */
export function useMountEffect(effect: () => void | (() => void)): void {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- once, by definition
  useEffect(effect, []);
}
