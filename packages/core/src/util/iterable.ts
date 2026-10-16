import type { Disposer } from "@nyte-ai/schema";

export const DONE = { done: true, value: undefined } as const;

export function latest<T>(
  initial: T,
  subscribe: (push: (value: T) => void) => Disposer,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let slot: { readonly value: T } | null = { value: initial };
      let waiting: ((result: IteratorResult<T>) => void) | null = null;
      let closed = false;

      const dispose = subscribe((value) => {
        const resolve = waiting;

        if (closed) return;

        if (resolve === null) {
          slot = { value };

          return;
        }

        waiting = null;
        resolve({ done: false, value });
      });

      return {
        next(): Promise<IteratorResult<T>> {
          const held = slot;

          if (closed) return Promise.resolve({ done: true, value: undefined });

          if (held !== null) {
            slot = null;

            return Promise.resolve({ done: false, value: held.value });
          }

          return new Promise((resolve) => {
            waiting = resolve;
          });
        },
        return(): Promise<IteratorResult<T>> {
          const resolve = waiting;
          waiting = null;

          if (!closed) {
            closed = true;
            dispose();
          }

          resolve?.({ done: true, value: undefined });

          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
}

export function closable<T>(
  open: () => {
    pull(): Promise<IteratorResult<T>>;
    close(): Promise<void> | void;
  },
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let source: ReturnType<typeof open> | null = null;
      let settle: ((result: IteratorResult<T>) => void) | null = null;
      let closing: Promise<void> | null = null;

      const close = (): Promise<void> => {
        if (closing !== null) return closing;
        const resolve = settle;
        settle = null;
        closing = Promise.resolve(source?.close());
        resolve?.(DONE);

        return closing;
      };

      return {
        next(): Promise<IteratorResult<T>> {
          if (closing !== null) return Promise.resolve(DONE);
          const opened = source ?? open();
          source = opened;
          const pulled = opened.pull();

          const end = (): void => {
            settle = null;
            close().catch(() => undefined);
          };

          pulled.then((result) => {
            if (result.done) end();
          }, end);

          return Promise.race([
            pulled,
            new Promise<IteratorResult<T>>((resolve) => {
              settle = resolve;
            }),
          ]);
        },
        async return(): Promise<IteratorResult<T>> {
          await close();

          return DONE;
        },
      };
    },
  };
}

export function coalesce<T>(source: AsyncIterable<T>, frameMs = 16): AsyncIterable<T> {
  return closable<T>(() => {
    const iterator = source[Symbol.asyncIterator]();
    let pending: { readonly value: T } | null = null;

    let ending:
      | { readonly kind: "ended" }
      | { readonly kind: "failed"; readonly error: unknown }
      | null = null;

    let wake: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let last = Number.NEGATIVE_INFINITY;

    const signal = (): void => {
      const resolve = wake;
      wake = null;
      resolve?.();
    };

    void (async () => {
      try {
        for (;;) {
          const next = await iterator.next();

          if (next.done || closed) break;
          pending = { value: next.value };
          signal();
        }

        ending = { kind: "ended" };
      } catch (error) {
        ending = { kind: "failed", error };
      }

      signal();
    })();

    return {
      async pull() {
        for (;;) {
          if (pending === null && ending === null) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }

          const wait = last + frameMs - Date.now();

          if (pending !== null && wait > 0) {
            await new Promise<void>((resolve) => {
              timer = setTimeout(resolve, wait);
            });
          }

          if (ending?.kind === "failed") throw ending.error;
          const held = pending;

          if (held !== null) {
            pending = null;
            last = Date.now();

            return { done: false, value: held.value };
          }

          if (ending !== null) return DONE;
        }
      },
      close() {
        closed = true;
        clearTimeout(timer);
        void Promise.resolve(iterator.return?.()).catch(() => undefined);
      },
    };
  });
}
