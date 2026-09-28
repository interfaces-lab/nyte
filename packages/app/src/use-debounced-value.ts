// oxlint-disable-next-line no-restricted-imports -- the timer restarts on each new value
import { useEffect, useState } from "react";

/** A copy of `value` that updates `delayMs` after the last change. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
