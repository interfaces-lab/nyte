import type { ClientConnection } from "@nyte-ai/sdk/client";
import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { countWork } from "../lib/work-counts.ts";
import { connected, onInstall } from "./connection.ts";

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

function withdrawNotice(notice: () => void): void {
  queued.delete(notice);

  if (queued.size === 0) cancelFlush();
}

function notifyAll(listeners: ReadonlySet<() => void>): void {
  for (const listener of Array.from(listeners)) listener();
}

/** What a store shows of its source's latest snapshot: nothing yet, a failed first read, or a value. */
export type Shown<T> =
  | { readonly kind: "waiting" }
  | { readonly kind: "failed"; readonly error: Error }
  | { readonly kind: "shown"; readonly value: T };

/** A synchronous source a store reads once on the microtask after each burst of changes. `show` gets the value it last showed in this opening, and returning it again publishes nothing. */
export interface LiveView<T> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly show: (previous: T | undefined) => Shown<T>;
  readonly close: () => void;
}

type Opening<T> = AsyncIterable<T> | LiveView<T>;

export class WatchStore<T> {
  private state: WatchState<T> = UNSTARTED;
  private readonly listeners = new Set<() => void>();
  private readonly renders = new Set<() => void>();
  private stop: (() => void) | undefined;
  private failures = 0;
  private readonly open: () => Opening<T> | Promise<Opening<T>>;
  private readonly idle: () => void;

  constructor(open: () => Opening<T> | Promise<Opening<T>>, idle: () => void = () => undefined) {
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

  reset(): void {
    this.stop?.();
    this.stop = undefined;
    this.failures = 0;
    this.publish(UNSTARTED);

    if (this.active) this.stop = this.start();
  }

  subscribe = (listener: () => void): (() => void) => this.listen(this.listeners, listener);

  subscribeByFrame = (listener: () => void): (() => void) => this.listen(this.renders, listener);

  getState = (): WatchState<T> => this.state;

  revise(value: T): void {
    this.state = { value, error: this.state.error };
    this.render();
  }

  /** Resolves with the current value when `accept` takes it, or else with the first coming one it takes, watching the store until then; rejects on the next error the store publishes. */
  until(accept: (value: T) => boolean): Promise<T> {
    const current = this.state.value;

    if (current !== undefined && accept(current)) return Promise.resolve(current);

    return new Promise((resolve, reject) => {
      const leave = this.subscribe(() => {
        const { value, error } = this.state;

        if (error !== undefined) {
          leave();
          reject(error);

          return;
        }

        if (value === undefined || !accept(value)) return;
        leave();
        resolve(value);
      });
    });
  }

  next(): Promise<T> {
    const seen = this.state.value;

    return this.until((value) => value !== seen);
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
    let leave: (() => void) | undefined;
    let reopen: ReturnType<typeof setTimeout> | undefined;

    const fail = (cause: unknown): void => {
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
    };

    const follow = (source: LiveView<T>): void => {
      let last: T | undefined;
      let queued = false;

      const read = (): void => {
        queued = false;

        if (stopped || leave === undefined) return;
        const shown = source.show(last);

        if (shown.kind === "failed") {
          leave();
          leave = undefined;
          fail(shown.error);

          return;
        }

        if (shown.kind === "waiting" || shown.value === last) return;
        last = shown.value;
        this.receive(shown.value);
      };

      const unsubscribe = source.subscribe(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(read);
      });

      leave = () => {
        unsubscribe();
        source.close();
      };

      read();
    };

    void (async () => {
      try {
        const source = await this.open();

        if (!(Symbol.asyncIterator in source)) {
          if (stopped) source.close();
          else follow(source);

          return;
        }

        if (stopped) return;
        iterator = source[Symbol.asyncIterator]();

        for (;;) {
          const next = await iterator.next();

          if (stopped || next.done === true) return;
          this.receive(next.value);
        }
      } catch (cause) {
        fail(cause);
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(reopen);
      leave?.();
      leave = undefined;
      void iterator?.return?.();
    };
  }

  private receive(value: T): void {
    this.failures = 0;
    const streaming = this.state.value !== undefined && this.state.error === undefined;
    this.state = { value, error: undefined };
    notifyAll(this.listeners);

    if (streaming) notifyByFrame(this.render);
    else this.render();
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
  open: (connection: ClientConnection, key: K) => Opening<T>,
) {
  const stores = new Map<K, WatchStore<T>>();

  const prune = (): void => {
    const inactive = [...stores].filter(([, store]) => !store.active);

    for (const [key, store] of inactive.slice(0, Math.max(0, inactive.length - RETAINED_WATCHES))) {
      stores.delete(key);
      store.dispose();
    }
  };

  onInstall((replaced) => {
    if (replaced) for (const store of stores.values()) store.reset();
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

export interface Opened<T> {
  read(): T | null;
  close(): void;
}

export function liveValues<T>(open: (changed: () => void) => Opened<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let dirty = true;
      let closed = false;
      let last: T | null = null;
      let wake: (() => void) | null = null;

      const resume = (): void => {
        const waiting = wake;
        wake = null;
        waiting?.();
      };

      const opened = open(() => {
        dirty = true;
        resume();
      });

      const readOrClose = (): T | null => {
        try {
          return opened.read();
        } catch (cause) {
          closed = true;
          opened.close();
          throw cause;
        }
      };

      return {
        async next(): Promise<IteratorResult<T>> {
          for (;;) {
            if (closed) return { done: true, value: undefined };

            if (dirty) {
              dirty = false;
              const value = readOrClose();

              if (value !== null && value !== last) {
                last = value;

                return { done: false, value };
              }

              continue;
            }

            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        },
        async return(): Promise<IteratorResult<T>> {
          if (!closed) {
            closed = true;
            opened.close();
          }

          resume();

          return { done: true, value: undefined };
        },
      };
    },
  };
}

const nothing = (): (() => void) => () => undefined;

const unstarted = (): WatchState<never> => UNSTARTED;

const noRetry = (): void => undefined;

export function useWatch<T>(
  store: WatchStore<T> | undefined,
  listening = true,
): WatchState<T> & { readonly retry: () => void } {
  const state = useSyncExternalStore(
    listening ? (store?.subscribeByFrame ?? nothing) : nothing,
    store?.getState ?? unstarted,
    store?.getState ?? unstarted,
  );

  return { value: state.value, error: state.error, retry: store?.retry ?? noRetry };
}

export type WatchSource<T> = Pick<WatchStore<T>, "subscribeByFrame" | "getState">;

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
