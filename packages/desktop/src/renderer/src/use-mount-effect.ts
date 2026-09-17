import { useEffect } from "react";

/**
 * The escape hatch for syncing with an external system: setup on mount,
 * cleanup on unmount. A value that changes belongs on a `key`, not in deps.
 */
export function useMountEffect(effect: () => void | (() => void)): void {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- mount-only is the contract
  useEffect(effect, []);
}
