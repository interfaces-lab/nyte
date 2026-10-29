import { useSyncExternalStore } from "react";

const MINUTE_MS = 60_000;

const listeners = new Set<() => void>();

let minute = currentMinute();

let timer: ReturnType<typeof setTimeout> | undefined;

function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
}

function tick(): void {
  minute = currentMinute();

  for (const listener of listeners) listener();
  timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (timer === undefined) timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));

  return () => {
    listeners.delete(listener);

    if (listeners.size > 0) return;
    clearTimeout(timer);
    timer = undefined;
  };
}

function readMinute(): number {
  if (timer === undefined) minute = currentMinute();

  return minute;
}

/** The current time floored to the minute; re-renders the caller when the minute changes. */
export function useNowMinute(): number {
  return useSyncExternalStore(subscribe, readMinute);
}
