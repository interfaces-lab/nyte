import { useSyncExternalStore } from "react";

export type Watched<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "failed"; readonly error: unknown; readonly last: T | undefined };

export interface Watchable<T> {
  watch(): AsyncIterable<T>;
}

const LOADING = { kind: "loading" } as const;

export function useWatch<T>(source: Watchable<T> | undefined): readonly [Watched<T>, () => void] {
  const store = watchStore(source);

  return [useSyncExternalStore(store.subscribe, store.getSnapshot), store.restart];
}

function watchStore<T>(source: Watchable<T> | undefined) {
  let snapshot: Watched<T> = LOADING;
  let iterator: AsyncIterator<T> | undefined;
  const listeners = new Set<() => void>();

  const publish = (next: Watched<T>) => {
    snapshot = next;

    for (const listener of listeners) listener();
  };

  const pump = async (current: AsyncIterator<T>) => {
    try {
      for (let next = await current.next(); !next.done; next = await current.next()) {
        if (iterator !== current) return;
        publish({ kind: "ready", value: next.value });
      }
    } catch (error) {
      if (iterator !== current) return;
      publish({
        kind: "failed",
        error,
        last: snapshot.kind === "ready" ? snapshot.value : undefined,
      });
    }
  };

  const open = () => {
    if (source === undefined || iterator !== undefined) return;
    iterator = source.watch()[Symbol.asyncIterator]();
    void pump(iterator);
  };

  const close = () => {
    const current = iterator;
    iterator = undefined;
    void current?.return?.();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      open();

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0) close();
      };
    },
    restart: () => {
      close();
      publish(LOADING);

      if (listeners.size > 0) open();
    },
  };
}
