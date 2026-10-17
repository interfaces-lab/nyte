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

/** Opens a host connection and installs it. A desktop or web shell calls this once it knows the endpoint. */
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

/**
 * The installed connection, once there is one. The shell mounts before the
 * host answers, so anything that can run that early (a watch, a query, a
 * send typed during startup) waits here rather than failing.
 */
export function connected(): Promise<Connection> {
  return ready;
}

export function currentConnection(): Connection | undefined {
  return installed;
}

/** The installed connection, for actions that only a mounted, connected screen can start. */
export function connection(): Connection {
  if (installed === undefined) throw new Error("No Nyte connection is installed");

  return installed;
}

/** A watch's latest frame and its failure; a new frame clears the failure. */
interface WatchState<T> {
  readonly value: T | undefined;
  readonly error: Error | undefined;
}

const UNSTARTED: WatchState<never> = { value: undefined, error: undefined };

class WatchStore<T> {
  private state: WatchState<T> = UNSTARTED;
  private readonly listeners = new Set<() => void>();
  private stop: (() => void) | undefined;
  private readonly open: () => AsyncIterable<T> | Promise<AsyncIterable<T>>;
  private readonly idle: () => void;

  /** `open` may wait before it has a source, as a family's watch waits for its connection. */
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

  /**
   * Stop and forget the watch. Subscribers get a new, empty state even when
   * nothing had arrived, so they render again and reach the store that
   * replaces this one.
   */
  dispose(): void {
    this.stop?.();
    this.stop = undefined;
    this.publish({ value: undefined, error: undefined });
  }

  /** Reopen a failed watch for its current subscribers, keeping the last frame on screen. */
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

  /** Shows `value` until the watch's own frames arrive, unless one already has. */
  prime(value: T): void {
    if (this.state.value !== undefined) return;
    this.publish({ value, error: undefined });
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

    void (async () => {
      try {
        const source = await this.open();

        if (stopped) return;
        iterator = source[Symbol.asyncIterator]();

        for (;;) {
          const next = await iterator.next();

          if (stopped || next.done === true) return;
          this.publish({ value: next.value, error: undefined });
        }
      } catch (cause) {
        if (stopped) return;
        this.publish({
          value: this.state.value,
          error: cause instanceof Error ? cause : new Error(String(cause)),
        });
      }
    })();

    return () => {
      stopped = true;
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

/** One watch per key, opened once a connection is installed and dropped when a new one replaces it. */
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

    const store = existing ?? new WatchStore(async () => open(await connected(), key), prune);
    stores.delete(key);
    stores.set(key, store);
    prune();

    return store;
  };
}

const nothing = (): (() => void) => () => undefined;

const unstarted = (): WatchState<never> => UNSTARTED;

const noRetry = (): void => undefined;

/** A watch's state plus `retry`, which reopens it after a failure. */
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
 * One slice of a watch's state. The component re-renders only when the slice
 * changes, so `select` must return a primitive or a part of the state, never
 * a new object.
 */
export function useWatchSelect<T, S>(
  store: WatchStore<T> | undefined,
  select: (state: WatchState<T>) => S,
): S {
  const read = (): S => select(store?.getState() ?? UNSTARTED);

  return useSyncExternalStore(store?.subscribe ?? nothing, read, read);
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

export const directoryWatch = watchFamily(
  (current, _key: "all"): AsyncIterable<readonly SessionInfo[]> =>
    current.sessions.watch({ parents: { kind: "all" } }),
);

export const childrenWatch = watchFamily(
  (current, session: SessionId): AsyncIterable<readonly SessionInfo[]> =>
    current.sessions.watch({ parents: { kind: "children", session } }),
);

/** Each session watch's pager. */
const pagers = new Map<SessionId, PagedViews>();

/** The oldest message a session showed when its pager last came back empty. */
const exhausted = new Map<SessionId, string>();

/** Resolves in the task after the next animation frame, once that frame has painted. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

/** A session's views, with its older messages paged in by `loadEarlierMessages`. */
export const sessionWatch = watchFamily(
  (current, session: SessionId): AsyncIterable<SessionView> => {
    const views = pagedViews(current.session(session));
    pagers.set(session, views);
    exhausted.delete(session);

    return tracePaints(views, session, nextFrame);
  },
);

const previews = new Map<SessionId, Promise<void>>();

/**
 * Reads a chat's view once and primes its watch with it, so opening the chat
 * shows it at once. A read, unlike a watch, leaves the chat unread.
 */
export function preloadSession(session: SessionId): Promise<void> {
  if (sessionWatch(session).value !== undefined) return Promise.resolve();

  const pending =
    previews.get(session) ??
    connected()
      .then((current) => current.session(session).view())
      .then(
        (view) => sessionWatch(session).prime(view),
        () => undefined,
      )
      .finally(() => previews.delete(session));

  previews.set(session, pending);

  return pending;
}

/**
 * Page up to `limit` older messages into a session's watch, resolving how many
 * came. Once a page comes back empty the host is not asked again until the
 * oldest message shown changes, so scrolling at the top stays quiet.
 */
export async function loadEarlierMessages(session: SessionId, limit: number): Promise<number> {
  const pager = pagers.get(session);
  const oldest = sessionWatch(session).value?.messages[0]?.id;

  if (pager === undefined || oldest === undefined || exhausted.get(session) === oldest) return 0;
  const loaded = await pager.earlier(limit);

  if (loaded === 0) exhausted.set(session, oldest);

  return loaded;
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
