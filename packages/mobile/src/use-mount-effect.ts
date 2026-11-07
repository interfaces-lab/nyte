import { useEffect } from "react";

export function useMountEffect(effect: () => void | (() => void)): void {
  // oxlint-disable-next-line nyte-code/no-direct-effect, react-hooks/exhaustive-deps -- the hatch itself
  useEffect(effect, []);
}
