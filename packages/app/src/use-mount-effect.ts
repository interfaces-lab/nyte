// oxlint-disable-next-line no-restricted-imports -- the hatch itself
import { useEffect } from "react";

export function useMountEffect(effect: () => void | (() => void)): void {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- mount-only is the contract
  useEffect(effect, []);
}
