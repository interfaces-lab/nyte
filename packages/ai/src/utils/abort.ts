function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";

  return error;
}

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

export function operationSignal(signal?: AbortSignal): AbortSignal {
  return signal ?? new AbortController().signal;
}

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
