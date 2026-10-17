import type { Disposer } from "@nyte-ai/schema";
import { closable } from "@nyte-ai/core";

export type FeedSink<T> = {
  push(value: T): void;
  fail(error: unknown): void;
  end(): void;
};

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
