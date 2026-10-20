import { pagedViews, sdk, SdkError, tracePaints } from "@nyte-ai/sdk";
import type {
  ConnectOptions,
  Connection,
  CredentialSource,
  GitStatus,
  HostId,
  HostView,
  JobView,
  PagedViews,
  SessionId,
  SessionInfo,
  SessionView,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { startupReadsReleased } from "./startup.ts";

export interface HostEndpoint {
  readonly url: string;
  readonly credentials: Extract<CredentialSource, { readonly kind: "token" | "pairing" }>;
  readonly expect?: { readonly hostId: HostId };
}

export interface ConnectionProblem {
  readonly kind: "authentication" | "network" | "incompatible" | "server";
  readonly message: string;
}

let installed: Connection | undefined;

const first = Promise.withResolvers<Connection>();

let ready = first.promise;

export async function connectHost(
  endpoint: HostEndpoint,
  options: {
    readonly journal?: ConnectOptions["journal"];
    readonly fetch?: ConnectOptions["fetch"];
    readonly remember?: (credential: CredentialSource) => void;
  } = {},
): Promise<Connection> {
  const connection = await sdk.connect({
    url: endpoint.url,
    credentials: endpoint.credentials,
    ...(endpoint.expect === undefined ? {} : { expect: endpoint.expect }),
    ...(options.journal === undefined ? {} : { journal: options.journal }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  if (connection.credential !== endpoint.credentials) options.remember?.(connection.credential);
  installConnection(connection);

  return connection;
}

export function installConnection(connection: Connection): void {
  const replaced = installed !== undefined;
  installed = connection;
  first.resolve(connection);
  ready = Promise.resolve(connection);

  if (replaced) for (const stores of registries) stores.clear();
}

export function connected(): Promise<Connection> {
  return ready;
}

export function currentConnection(): Connection | undefined {
  return installed;
}

export function connection(): Connection {
  if (installed === undefined) throw new Error("No Nyte connection is installed");

  return installed;
}

export interface WatchState<T> {
  readonly value: T | undefined;
  readonly error: Error | undefined;
}

const UNSTARTED: WatchState<never> = { value: undefined, error: undefined };

const FIRST_REOPEN_MS = 1_000;

const MAX_REOPEN_MS = 30_000;

export class WatchStore<T> {
  private state: WatchState<T> = UNSTARTED;
  private readonly listeners = new Set<() => void>();
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
    return this.listeners.size > 0;
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

    if (this.listeners.size > 0) this.stop = this.start();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.stop ??= this.start();

    return () => {
      this.listeners.delete(listener);
      queueMicrotask(() => {
        if (this.listeners.size !== 0) return;
        this.stop?.();
        this.stop = undefined;
        this.idle();
      });
    };
  };

  getState = (): WatchState<T> => this.state;

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
          this.publish({ value: next.value, error: undefined });
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

    for (const listener of Array.from(this.listeners)) listener();
  }
}

const registries = new Set<{ clear(): void }>();

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
      const previous = [...stores.values()];
      stores.clear();

      for (const store of previous) store.dispose();
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
    store?.subscribe ?? nothing,
    store?.getState ?? unstarted,
    store?.getState ?? unstarted,
  );

  return { value: state.value, error: state.error, retry: store?.retry ?? noRetry };
}

/**
 * Reads one selection of a watch and re-renders only when it changes. Without `isEqual` a
 * change is a new reference, so a selection derived into a fresh object needs `isEqual`.
 */
export function useWatchSelect<T, S>(
  store: WatchStore<T> | undefined,
  select: (state: WatchState<T>) => S,
  isEqual?: (previous: S, next: S) => boolean,
): S {
  const read: () => WatchState<T> = store?.getState ?? unstarted;

  return useSyncExternalStoreWithSelector(store?.subscribe ?? nothing, read, read, select, isEqual);
}

export function hostChanged(cause: unknown): boolean {
  return cause instanceof SdkError && cause.code === "stale";
}

export function connectionProblem(cause: unknown): ConnectionProblem {
  if (!(cause instanceof SdkError)) {
    return {
      kind: "network",
      message: "Cannot reach the server. Check your connection and try again.",
    };
  }

  switch (cause.code) {
    case "unauthenticated":
    case "denied":
      return {
        kind: "authentication",
        message: "The server rejected this token. Update the connection token.",
      };
    case "unavailable":
      return {
        kind: "network",
        message: "Cannot reach the server. Check your connection and try again.",
      };
    case "stale":
      return {
        kind: "incompatible",
        message: "A different host answered at this address. Pair with it again.",
      };
    case "unknown":
    case "invalid":
      return {
        kind: "incompatible",
        message: "This server does not support this app's protocol. Check its URL and version.",
      };
    case "internal":
      return {
        kind: "server",
        message:
          "The server could not complete this request. Check its deployment logs and try again.",
      };
    default: {
      const exhaustive: never = cause.code;

      return exhaustive;
    }
  }
}

export const hostWatch = watchFamily((current, _key: "host"): AsyncIterable<HostView> =>
  current.watch(),
);

export const sessionsWatch = watchFamily(
  (current, parents: "roots" | "all"): AsyncIterable<readonly SessionInfo[]> =>
    current.sessions.watch({ parents: { kind: parents } }),
);

export function findListedSession(session: SessionId): SessionInfo | undefined {
  return (
    sessionsWatch("roots").value?.find((item) => item.id === session) ??
    sessionsWatch("all").value?.find((item) => item.id === session)
  );
}

export const childrenWatch = watchFamily(
  (current, session: SessionId): AsyncIterable<readonly SessionInfo[]> =>
    current.sessions.watch({ parents: { kind: "children", session } }),
);

const OPENING_TAIL = 40;

const pagers = new Map<SessionId, PagedViews>();

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function keepItems<T>(
  shown: readonly T[],
  next: readonly T[],
  key: (item: T) => string,
): readonly T[] {
  const known = new Map(shown.map((item) => [key(item), item]));

  const items = next.map((item) => {
    const kept = known.get(key(item));

    return kept !== undefined && JSON.stringify(kept) === JSON.stringify(item) ? kept : item;
  });

  return items.length === shown.length && items.every((item, index) => item === shown[index])
    ? shown
    : items;
}

function keepShown(shown: SessionView, next: SessionView): SessionView {
  return {
    ...next,
    messages: keepItems(shown.messages, next.messages, (message) => message.id),
    turns: keepItems(shown.turns, next.turns, (turn) => turn.id),
    changes: keepItems(shown.changes, next.changes, (change) => change.path),
  };
}

export const sessionWatch = watchFamily(
  (current, session: SessionId): AsyncIterable<SessionView> => {
    const kept: AsyncIterable<SessionView> = {
      [Symbol.asyncIterator]() {
        const views = pagedViews(current.session(session), { tail: OPENING_TAIL });
        const iterator = views[Symbol.asyncIterator]();
        pagers.set(session, views);
        let first = true;

        return {
          async next() {
            const next = await iterator.next();

            if (next.done === true || !first) return next;
            first = false;
            const shown = sessionWatch(session).value;

            return shown === undefined
              ? next
              : { done: false, value: keepShown(shown, next.value) };
          },
          async return() {
            if (pagers.get(session) === views) pagers.delete(session);
            await iterator.return?.();

            return { done: true, value: undefined };
          },
        };
      },
    };

    return tracePaints(kept, session, nextFrame);
  },
);

const WARM_SESSIONS = 3;

const WARM_MS = 5_000;

const hotSet = new Map<SessionId, () => void>();

export function warmSession(session: SessionId): void {
  const holds = [
    sessionWatch(session).subscribe(() => undefined),
    childrenWatch(session).subscribe(() => undefined),
  ];

  const release = (): void => {
    clearTimeout(timer);

    if (hotSet.get(session) === release) hotSet.delete(session);

    for (const leave of holds) leave();
  };

  const timer = setTimeout(release, WARM_MS);
  hotSet.get(session)?.();
  hotSet.set(session, release);

  if (hotSet.size > WARM_SESSIONS) hotSet.values().next().value?.();
}

export async function loadEarlierMessages(session: SessionId, limit: number): Promise<number> {
  return (await pagers.get(session)?.earlier(limit)) ?? 0;
}

export const jobsWatch = watchFamily(
  (current, workspace: WorkspaceId): AsyncIterable<readonly JobView[]> =>
    current.workspace(workspace).jobs.watch(),
);

export const gitStatusWatch = watchFamily(
  (current, workspace: WorkspaceId): AsyncIterable<GitStatus> =>
    (async function* () {
      await startupReadsReleased();
      const git = await current.workspace(workspace).git();

      if (git.kind === "available") yield* git.api.watch();
    })(),
);
