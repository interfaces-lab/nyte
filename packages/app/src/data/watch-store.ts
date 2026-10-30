import type { Connection } from "@nyte-ai/sdk";
import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { countWork } from "../lib/work-counts.ts";
import { connected, registries } from "./connection.ts";

export interface WatchState<T> {
  readonly value: T | undefined;
  readonly error: Error | undefined;
}

const UNSTARTED: WatchState<never> = { value: undefined, error: undefined };

const FIRST_REOPEN_MS = 1_000;

const MAX_REOPEN_MS = 30_000;

const HIDDEN_FLUSH_MS = 100;

const queued = new Set<() => void>();

let scheduled:
  | { readonly frame: number; readonly timer: ReturnType<typeof setTimeout> }
  | undefined;

function cancelFlush(): void {
  if (scheduled === undefined) return;
  cancelAnimationFrame(scheduled.frame);
  clearTimeout(scheduled.timer);
  scheduled = undefined;
}

function flushQueued(): void {
  cancelFlush();
  const notices = [...queued];
  queued.clear();

  for (const notice of notices) notice();
}

/**
 * Queues a store's React notice for one flush on the next frame, so React renders once per frame
 * however many deltas arrive. A timer flushes while a hidden window pauses frames; without frames
 * (Node) it notifies at once.
 */
function notifyByFrame(notice: () => void): void {
  if (typeof requestAnimationFrame !== "function") {
    notice();

    return;
  }

  queued.add(notice);
  scheduled ??= {
    frame: requestAnimationFrame(flushQueued),
    timer: setTimeout(flushQueued, HIDDEN_FLUSH_MS),
  };
}

/** Drops a notice its store delivered sooner, and the scheduled flush once nothing is queued. */
function withdrawNotice(notice: () => void): void {
  queued.delete(notice);

  if (queued.size === 0) cancelFlush();
}

function notifyAll(listeners: ReadonlySet<() => void>): void {
  for (const listener of Array.from(listeners)) listener();
}

export class WatchStore<T> {
  private state: WatchState<T> = UNSTARTED;
  private readonly listeners = new Set<() => void>();
  private readonly renders = new Set<() => void>();
  private stop: (() => void) | undefined;
  private failures = 0;
  private readonly open: () => AsyncIterable<T> | Promise<AsyncIterable<T>>;
  private readonly idle: () => void;

  constructor(
    open: () => AsyncIterable<T> | Promise<AsyncIterable<T>>,
    idle: () => void = () => undefined,
  ) {
    this.open = open;
    this.idle = idle;
  }

  get value(): T | undefined {
    return this.state.value;
  }

  get error(): Error | undefined {
    return this.state.error;
  }

  get active(): boolean {
    return this.listeners.size > 0 || this.renders.size > 0;
  }

  dispose(): void {
    this.stop?.();
    this.stop = undefined;
    this.publish({ value: undefined, error: undefined });
  }

  retry = (): void => {
    this.stop?.();
    this.stop = undefined;
    this.publish({ value: this.state.value, error: undefined });

    if (this.active) this.stop = this.start();
  };

  /** Starts over on the current connection, keeping its listeners: drops the value and reopens while anyone listens. */
  reset(): void {
    this.stop?.();
    this.stop = undefined;
    this.failures = 0;
    this.publish(UNSTARTED);

    if (this.active) this.stop = this.start();
  }

  /** Hears every value as it arrives. */
  subscribe = (listener: () => void): (() => void) => this.listen(this.listeners, listener);

  /** Like `subscribe`, but hears streamed values at most once a frame, for React to render. */
  subscribeByFrame = (listener: () => void): (() => void) => this.listen(this.renders, listener);

  getState = (): WatchState<T> => this.state;

  revise(value: T): void {
    this.state = { value, error: this.state.error };
    this.render();
  }

  first(): Promise<void> {
    if (this.state.value !== undefined || this.state.error !== undefined || !this.active)
      return Promise.resolve();

    return this.next().then(
      () => undefined,
      () => undefined,
    );
  }

  next(): Promise<T> {
    return new Promise((resolve, reject) => {
      const seen = this.state.value;

      const leave = this.subscribe(() => {
        const { value, error } = this.state;

        if (error !== undefined) {
          leave();
          reject(error);

          return;
        }

        if (value === undefined || value === seen) return;
        leave();
        resolve(value);
      });
    });
  }

  private listen(listeners: Set<() => void>, listener: () => void): () => void {
    listeners.add(listener);
    this.stop ??= this.start();

    return () => {
      listeners.delete(listener);
      queueMicrotask(() => {
        if (this.active) return;
        this.stop?.();
        this.stop = undefined;
        this.idle();
      });
    };
  }

  private start(): () => void {
    let stopped = false;
    let iterator: AsyncIterator<T> | undefined;
    let reopen: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      try {
        const source = await this.open();

        if (stopped) return;
        iterator = source[Symbol.asyncIterator]();

        for (;;) {
          const next = await iterator.next();

          if (stopped || next.done === true) return;
          this.failures = 0;
          const streaming = this.state.value !== undefined && this.state.error === undefined;
          this.state = { value: next.value, error: undefined };
          notifyAll(this.listeners);

          if (streaming) notifyByFrame(this.render);
          else this.render();
        }
      } catch (cause) {
        if (stopped) return;
        this.failures += 1;
        this.publish({
          value: this.state.value,
          error: cause instanceof Error ? cause : new Error(String(cause)),
        });
        reopen = setTimeout(
          () => {
            if (!stopped) this.stop = this.start();
          },
          Math.min(FIRST_REOPEN_MS * 2 ** (this.failures - 1), MAX_REOPEN_MS),
        );
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(reopen);
      void iterator?.return?.();
    };
  }

  private publish(state: WatchState<T>): void {
    this.state = state;
    notifyAll(this.listeners);
    this.render();
  }

  private readonly render = (): void => {
    withdrawNotice(this.render);
    countWork("notify");
    notifyAll(this.renders);
  };
}

const RETAINED_WATCHES = 16;

export function watchFamily<K extends string, T>(
  open: (connection: Connection, key: K) => AsyncIterable<T>,
) {
  const stores = new Map<K, WatchStore<T>>();

  const prune = (): void => {
    const inactive = [...stores].filter(([, store]) => !store.active);

    for (const [key, store] of inactive.slice(0, Math.max(0, inactive.length - RETAINED_WATCHES))) {
      stores.delete(key);
      store.dispose();
    }
  };

  registries.add({
    clear() {
      for (const store of stores.values()) store.reset();
    },
  });

  return (key: K): WatchStore<T> => {
    const existing = stores.get(key);

    if (existing !== undefined) return existing;

    const store: WatchStore<T> = new WatchStore(
      async () => open(await connected(), key),
      () => {
        if (stores.get(key) === store) {
          stores.delete(key);
          stores.set(key, store);
        }

        prune();
      },
    );

    stores.set(key, store);
    prune();

    return store;
  };
}

const nothing = (): (() => void) => () => undefined;

const unstarted = (): WatchState<never> => UNSTARTED;

const noRetry = (): void => undefined;

export function useWatch<T>(
  store: WatchStore<T> | undefined,
): WatchState<T> & { readonly retry: () => void } {
  const state = useSyncExternalStore(
    store?.subscribeByFrame ?? nothing,
    store?.getState ?? unstarted,
    store?.getState ?? unstarted,
  );

  return { value: state.value, error: state.error, retry: store?.retry ?? noRetry };
}

export type WatchSource<T> = Pick<WatchStore<T>, "subscribeByFrame" | "getState">;

/**
 * Reads one selection of a watch and re-renders only when it changes. Without `isEqual` a
 * change is a new reference, so a selection derived into a fresh object needs `isEqual`.
 */
export function useWatchSelect<T, S>(
  store: WatchSource<T> | undefined,
  select: (state: WatchState<T>) => S,
  isEqual?: (previous: S, next: S) => boolean,
): S {
  const read: () => WatchState<T> = store?.getState ?? unstarted;

  return useSyncExternalStoreWithSelector(
    store?.subscribeByFrame ?? nothing,
    read,
    read,
    select,
    isEqual,
  );
}
