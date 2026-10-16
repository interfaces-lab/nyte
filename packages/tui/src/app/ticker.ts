import { createSignal, getOwner, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { Clock } from "../effects/ports.ts";

export interface Tickers {
  ticker(intervalMs: number): Accessor<number>;
  now(): number;
  dispose(): void;
}

interface Shared {
  readonly tick: Accessor<number>;
  readonly advance: () => void;
  readers: number;
  stop: (() => void) | null;
}

export function createTickers(
  clock: Clock,
  schedule: (callback: () => void, intervalMs: number) => () => void,
): Tickers {
  const shared = new Map<number, Shared>();

  const release = (entry: Shared): void => {
    entry.readers -= 1;

    if (entry.readers > 0) return;
    entry.stop?.();
    entry.stop = null;
  };

  return {
    ticker(intervalMs) {
      const existing = shared.get(intervalMs);
      const entry = existing ?? created();
      shared.set(intervalMs, entry);
      entry.readers += 1;

      if (entry.readers === 1) entry.stop = schedule(entry.advance, intervalMs);

      if (getOwner() !== null) onCleanup(() => release(entry));

      return entry.tick;
    },
    now: () => clock.now(),
    dispose() {
      for (const entry of shared.values()) {
        entry.stop?.();
        entry.stop = null;
        entry.readers = 0;
      }
    },
  };
}

function created(): Shared {
  const [tick, setTick] = createSignal(0);

  return { tick, advance: () => setTick((count) => count + 1), readers: 0, stop: null };
}
