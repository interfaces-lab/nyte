import type { Disposer } from "@nyte-ai/schema";
import { closable } from "@nyte-ai/core";

/** Returns the callbacks a feed's source gets: `push` a value, `fail` the feed with an error, `end` it. */
export type FeedSink<T> = {
  push(value: T): void;
  fail(error: unknown): void;
  end(): void;
};

/** Returns an iterable over what a source pushes, without ever holding the source back: `start` runs on the first pull and its disposer on `return()` or the end; a value pushed while none is being pulled waits, `merge`d with the one already waiting (default: the newer replaces it); a pull waits for the next value; `fail` throws once the waiting value is read, and `end` finishes after it. */
export function feed<T>(
  start: (sink: FeedSink<T>) => Disposer,
  merge: (waiting: T, next: T) => T = (_waiting, next) => next,
): AsyncIterable<T> {
  return closable<T>(() => {
    const state: {
      slot: { readonly value: T } | null;
      outcome:
        | { readonly kind: "ended" }
        | { readonly kind: "failed"; readonly error: unknown }
        | null;
      wake: (() => void) | null;
    } = { slot: null, outcome: null, wake: null };

    const signal = (): void => {
      const resolve = state.wake;
      state.wake = null;
      resolve?.();
    };

    const dispose = start({
      push(value) {
        if (state.outcome !== null) return;
        state.slot = { value: state.slot === null ? value : merge(state.slot.value, value) };
        signal();
      },
      fail(error) {
        state.outcome ??= { kind: "failed", error };
        signal();
      },
      end() {
        state.outcome ??= { kind: "ended" };
        signal();
      },
    });

    return {
      async pull(): Promise<IteratorResult<T>> {
        for (;;) {
          const held = state.slot;

          if (held !== null) {
            state.slot = null;

            return { done: false, value: held.value };
          }

          const outcome = state.outcome;

          if (outcome?.kind === "failed") throw outcome.error;

          if (outcome?.kind === "ended") return { done: true, value: undefined };
          await new Promise<void>((resolve) => {
            state.wake = resolve;
          });
        }
      },
      close: () => dispose(),
    };
  });
}
