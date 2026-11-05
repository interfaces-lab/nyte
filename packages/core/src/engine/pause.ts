import type { Kernel } from "../contract/kernel.ts";

/**
 * Holds back this host's model requests, as while the machine sleeps: the streams in flight end
 * and the turns driving them wait in `unpaused` without failing, leases or tools untouched.
 * Pausing again while paused does nothing.
 */
export function pause(kernel: Kernel): void {
  const state = kernel.executionState;

  if (state.paused !== null) return;
  state.paused = Promise.withResolvers<void>();
  state.streams.abort();
}

/** Lets the paused turns request again; does nothing while not paused. */
export function resume(kernel: Kernel): void {
  const state = kernel.executionState;
  const paused = state.paused;

  if (paused === null) return;
  state.paused = null;
  state.streams = new AbortController();
  paused.resolve();
}

/** Resolves at once while not paused, else when the pause ends or `signal` aborts. */
export async function unpaused(kernel: Kernel, signal: AbortSignal): Promise<void> {
  const paused = kernel.executionState.paused;

  if (paused === null || signal.aborted) return;
  const aborted = Promise.withResolvers<void>();
  const stop = (): void => aborted.resolve();
  signal.addEventListener("abort", stop, { once: true });

  try {
    await Promise.race([paused.promise, aborted.promise]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
