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

/** How long an opening stays open before its end counts as a fresh start rather than a failure. */
const STEADY_MS = 30_000;

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

/**
 * A synchronous source a store reads once on the microtask after each burst of changes. `show`
 * gets the value it last showed in this opening, and returning it again publishes nothing. A
 * failed read shows as the store's error while the source stays open: the source retries it, and
 * its next value clears the error.
 */
export interface LiveView<T> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly show: (previous: T | undefined) => Shown<T>;
  readonly close: () => void;
}

/**
 * A stream a store follows, and what its end means: `finished` keeps the last value as the final
 * one until the store opens again; `reopen` opens it again on the reopen backoff, as a stream that
 * fails does. A stream that fails publishes its error and reopens on the same backoff, which starts
 * again only after an opening stays open a while.
 */
export interface Stream<T> {
  readonly values: AsyncIterable<T>;
  readonly ended: "finished" | "reopen";
}

type Opening<T> = Stream<T> | LiveView<T>;

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

  /** Opens the store again from nothing, or, with `carry`, from what `carry` makes of its value. */
  reset(carry?: (value: T) => T): void {
    const value = this.state.value;
    this.stop?.();
    this.stop = undefined;
    this.failures = 0;
    this.publish(
      carry === undefined || value === undefined
        ? UNSTARTED
        : { value: carry(value), error: undefined },
    );

    if (this.active) this.stop = this.start();
  }

  subscribe = (listener: () => void): (() => void) => this.listen(this.listeners, listener);

  subscribeByFrame = (listener: () => void): (() => void) => this.listen(this.renders, listener);

  getState = (): WatchState<T> => this.state;

  read = (): T | undefined => this.state.value;

  revise(value: T): void {
    this.state = { value, error: this.state.error };
    this.render();
  }

  /** Resolves with the current value when `accept` takes it, or else with the first coming one it takes, watching the store until then; rejects on the next error the store publishes, or with `signal`'s reason when it aborts first, and stops watching either way. */
  until(accept: (value: T) => boolean, signal?: AbortSignal): Promise<T> {
    const current = this.state.value;

    if (current !== undefined && accept(current)) return Promise.resolve(current);

    return new Promise((resolve, reject) => {
      const end = (): void => {
        signal?.removeEventListener("abort", aborted);
        leave();
      };

      const aborted = (): void => {
        end();
        reject(signal?.reason);
      };

      const leave = this.subscribe(() => {
        const { value, error } = this.state;

        if (error !== undefined) {
          end();
          reject(error);

          return;
        }

        if (value === undefined || !accept(value)) return;
        end();
        resolve(value);
      });

      if (signal?.aborted === true) aborted();
      else signal?.addEventListener("abort", aborted, { once: true });
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
    let leave: (() => void) | undefined;
    let reopen: ReturnType<typeof setTimeout> | undefined;

    const opened = Date.now();

    const later = (): void => {
      const next = nextReopen(this.failures, Date.now() - opened);
      this.failures = next.failures;
      reopen = setTimeout(() => {
        if (!stopped) this.stop = this.start();
      }, next.delay);
    };

    const fail = (cause: unknown): void => {
      if (stopped) return;
      this.publish({
        value: this.state.value,
        error: cause instanceof Error ? cause : new Error(String(cause)),
      });
      later();
    };

    const follow = (source: LiveView<T>): void => {
      let last: T | undefined;
      let queued = false;

      const read = (): void => {
        queued = false;

        if (stopped || leave === undefined) return;
        const shown = source.show(last);

        if (shown.kind === "failed") {
          if (shown.error !== this.state.error)
            this.publish({ value: this.state.value, error: shown.error });

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

        if (!("values" in source)) {
          if (stopped) source.close();
          else follow(source);

          return;
        }

        if (stopped) return;
        iterator = source.values[Symbol.asyncIterator]();

        for (;;) {
          const next = await iterator.next();

          if (stopped) return;

          if (next.done === true) {
            if (source.ended === "reopen") later();

            return;
          }

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

/**
 * The count of short openings in a row after one that lasted `openedMs`, and the wait before the
 * next: 1 s doubling to 30 s. A value delivered doesn't start the count again, since a stream that
 * delivers and ends at once is as broken as one that ends empty; only staying open `STEADY_MS` does.
 */
function nextReopen(failures: number, openedMs: number) {
  const count = (openedMs >= STEADY_MS ? 0 : failures) + 1;

  return { failures: count, delay: Math.min(FIRST_REOPEN_MS * 2 ** (count - 1), MAX_REOPEN_MS) };
}

const RETAINED_WATCHES = 16;

/**
 * One store per key, each opened on the installed connection. A connection that replaces it opens
 * every store again: from nothing for another host, or from what `carry` makes of its value for
 * the same host, so the store shows that until the new connection's first read lands.
 */
export function watchFamily<K extends string, T>(
  open: (connection: ClientConnection, key: K) => Opening<T> | Promise<Opening<T>>,
  carry?: (value: T) => T,
) {
  const stores = new Map<K, WatchStore<T>>();

  const prune = (): void => {
    const inactive = [...stores].filter(([, store]) => !store.active);

    for (const [key, store] of inactive.slice(0, Math.max(0, inactive.length - RETAINED_WATCHES))) {
      stores.delete(key);
      store.dispose();
    }
  };

  onInstall((replaced, sameHost) => {
    if (replaced) for (const store of stores.values()) store.reset(sameHost ? carry : undefined);
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
