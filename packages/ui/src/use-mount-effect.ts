import { useEffect } from "react";

/**
 * The escape hatch for mount-shaped work: subscribing to an external system,
 * starting a session, or aborting on unmount. Anything driven by a changing
 * value is derived state, an event, a query, or a remount with `key`.
 */
export function useMountEffect(effect: () => void | (() => void)): void {
  // oxlint-disable-next-line nyte-code/no-direct-effect, react-hooks/exhaustive-deps -- the hatch itself
  useEffect(effect, []);
}
