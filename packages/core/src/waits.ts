import type { Disposer, RequestOptions, SessionId } from "@nyte-ai/schema";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";

const receiptListeners = new WeakMap<Kernel, Map<string, Set<() => void>>>();

/** Calls the listener whenever a receipt is settled in this process; the disposer stops it. */
export function onReceipt(
  kernel: Kernel,
  session: SessionId,
  id: string,
  listener: () => void,
): Disposer {
  const byReceipt = receiptListeners.get(kernel) ?? new Map<string, Set<() => void>>();
  const key = `${session}/${id}`;
  const listeners = byReceipt.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  byReceipt.set(key, listeners);
  receiptListeners.set(kernel, byReceipt);

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0 && byReceipt.get(key) === listeners) byReceipt.delete(key);
  };
}

/** Wakes every in-process wait on a receipt. */
export function notifyReceipt(kernel: Kernel, session: SessionId, id: string): void {
  for (const listener of receiptListeners.get(kernel)?.get(`${session}/${id}`) ?? []) listener();
}

/** Resolves with the first value `check` finds, checking once now and again on every trigger; abort rejects `unavailable` and stops the wait, never the work. */
export function waitFor<T>(input: {
  readonly options?: RequestOptions;
  readonly check: () => Promise<{ readonly value: T } | null>;
  readonly subscribe: (trigger: () => void) => Disposer;
}): Promise<T> {
  const signal = input.options?.signal;

  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new SdkError("unavailable", "aborted"));

      return;
    }

    let done = false;
    let checking = false;
    let again = false;
    let dispose: Disposer = () => {};

    const finish = (): void => {
      done = true;
      dispose();
      signal?.removeEventListener("abort", abort);
    };

    const abort = (): void => {
      if (done) return;
      finish();
      reject(new SdkError("unavailable", "aborted"));
    };

    const check = (): void => {
      if (done) return;

      if (checking) {
        again = true;

        return;
      }

      checking = true;
      input.check().then(
        (found) => {
          checking = false;

          if (done) return;

          if (found !== null) {
            finish();
            resolve(found.value);

            return;
          }

          if (!again) return;
          again = false;
          check();
        },
        (error: unknown) => {
          checking = false;

          if (done) return;
          finish();
          reject(error);
        },
      );
    };

    signal?.addEventListener("abort", abort, { once: true });
    dispose = input.subscribe(check);
    check();
  });
}
