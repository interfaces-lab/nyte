import { sdk, SdkError } from "@nyte-ai/sdk";
import type {
  ConnectOptions,
  Connection,
  CredentialSource,
  GitStatus,
  HostId,
  HostView,
  JobView,
  SessionId,
  SessionInfo,
  SessionView,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { useSyncExternalStore } from "react";

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
  installed = connection;

  for (const stores of registries) stores.clear();
}

export function currentConnection(): Connection | undefined {
  return installed;
}

export function connection(): Connection {
  if (installed === undefined) throw new Error("No Nyte connection is installed");

  return installed;
}

/** A watch's latest frame and its failure; a new frame clears the failure. */
export interface WatchState<T> {
  readonly value: T | undefined;
  readonly error: Error | undefined;
}

const UNSTARTED: WatchState<never> = { value: undefined, error: undefined };

export class WatchStore<T> {
  private state: WatchState<T> = UNSTARTED;
  private readonly listeners = new Set<() => void>();
  private stop: (() => void) | undefined;
  private readonly open: () => AsyncIterable<T>;
  private readonly idle: () => void;

  constructor(open: () => AsyncIterable<T>, idle: () => void = () => undefined) {
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
    this.publish(UNSTARTED);
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
    const iterator = this.open()[Symbol.asyncIterator]();

    void (async () => {
      try {
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
      void iterator.return?.();
    };
  }

  private publish(state: WatchState<T>): void {
    this.state = state;

    for (const listener of Array.from(this.listeners)) listener();
  }
}

const registries = new Set<{ clear(): void }>();

const RETAINED_WATCHES = 16;

export function watchFamily<K extends string, T>(open: (key: K) => AsyncIterable<T>) {
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

    const store = existing ?? new WatchStore(() => open(key), prune);
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

export const hostWatch = watchFamily((_key: "host"): AsyncIterable<HostView> =>
  connection().watch(),
);

export const directoryWatch = watchFamily((_key: "all"): AsyncIterable<readonly SessionInfo[]> =>
  connection().sessions.watch({ parents: { kind: "all" } }),
);

export const childrenWatch = watchFamily(
  (session: SessionId): AsyncIterable<readonly SessionInfo[]> =>
    connection().sessions.watch({ parents: { kind: "children", session } }),
);

export const sessionWatch = watchFamily((session: SessionId): AsyncIterable<SessionView> =>
  connection().session(session).watch(),
);

export const jobsWatch = watchFamily((workspace: WorkspaceId): AsyncIterable<readonly JobView[]> =>
  connection().workspace(workspace).jobs.watch(),
);

export const gitStatusWatch = watchFamily((workspace: WorkspaceId): AsyncIterable<GitStatus> =>
  (async function* () {
    const git = await connection().workspace(workspace).git();

    if (git.kind === "available") yield* git.api.watch();
  })(),
);
