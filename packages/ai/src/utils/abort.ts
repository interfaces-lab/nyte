/**
 * AbortSignal helpers: an interruptible sleep, an operation-local signal for optional-signal APIs, and racing a promise against a signal while still observing the abandoned promise.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/utils/abort.ts
 * Synced with pi 7fbbd5f4a.
 */
function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";

  return error;
}

/**
 * Resolve after `ms`, or reject with `abortError()` once `signal` aborts.
 * The abort listener is detached when the timer fires.
 */
export function sleep(
  ms: number,
  signal: AbortSignal | undefined,
  abortError: () => Error,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());

      return;
    }

    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };

    const timeout = setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.max(0, ms),
    );

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Create an operation-local signal for public APIs whose signal is optional. */
export function operationSignal(signal?: AbortSignal): AbortSignal {
  return signal ?? new AbortController().signal;
}

/**
 * Stop waiting for an operation when its signal aborts while continuing to
 * observe the abandoned promise so a later rejection is always handled.
 */
export function raceWithAbortSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => {});

    return Promise.reject(abortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortReason(signal));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );

    if (signal.aborted) onAbort();
  });
}
