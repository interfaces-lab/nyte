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

/** How the shell reaches its host: the URL, the credential, and the host id pinned for it. */
export interface HostEndpoint {
  readonly url: string;
  readonly credentials: Extract<CredentialSource, { readonly kind: "token" | "pairing" }>;
  readonly expect?: { readonly hostId: HostId };
}

/** Why a connect or a request failed, as the copy the shell shows. */
export interface ConnectionProblem {
  readonly kind: "authentication" | "network" | "incompatible" | "server";
  readonly message: string;
}

let installed: Connection | undefined;

/**
 * Connects to the shell's host with `sdk.connect` and installs the connection
 * every read and watch goes through. A pairing connect yields a device token;
 * `remember` hands it to the shell to persist, so the next start connects
 * with it.
 */
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

/** Installs the one connection the interface reads; tests install a scripted one. */
export function installConnection(connection: Connection): void {
  installed = connection;

  for (const stores of registries) stores.clear();
}

/** The installed connection, if any. */
export function currentConnection(): Connection | undefined {
  return installed;
}

/** The installed connection. Throws before `connectHost` or `installConnection` ran. */
export function connection(): Connection {
  if (installed === undefined) throw new Error("No Nyte connection is installed");

  return installed;
}

/**
 * One watch shared by every reader: it opens with the first subscriber,
 * publishes each yield, and closes a microtask after the last one leaves, so
 * a remount does not reopen it. A watch that throws keeps its last value.
 */
export class WatchStore<T> {
  value: T | undefined = undefined;
  error: Error | undefined = undefined;
  private readonly listeners = new Set<() => void>();
  private stop: (() => void) | undefined;
  private readonly open: () => AsyncIterable<T>;

  constructor(open: () => AsyncIterable<T>) {
    this.open = open;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.stop ??= this.start();

    return () => {
      this.listeners.delete(listener);
      queueMicrotask(() => {
        if (this.listeners.size !== 0) return;
        this.stop?.();
        this.stop = undefined;
      });
    };
  };

  getValue = (): T | undefined => this.value;

  /** Resolves with the next value the watch yields, opening it meanwhile. */
  next(): Promise<T> {
    return new Promise((resolve, reject) => {
      const seen = this.value;
      const leave = this.subscribe(() => {
        if (this.error !== undefined) {
          leave();
          reject(this.error);

          return;
        }

        if (this.value === undefined || this.value === seen) return;
        leave();
        resolve(this.value);
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
          this.value = next.value;
          this.error = undefined;
          this.notify();
        }
      } catch (cause) {
        if (stopped) return;
        this.error = cause instanceof Error ? cause : new Error(String(cause));
        this.notify();
      }
    })();

    return () => {
      stopped = true;
      void iterator.return?.();
    };
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }
}

const registries = new Set<{ clear(): void }>();

/**
 * A family of shared watches of one type, keyed by what they watch (a
 * session id, a workspace id). Installing another connection empties it.
 */
export function watchFamily<K extends string, T>(open: (key: K) => AsyncIterable<T>) {
  const stores = new Map<K, WatchStore<T>>();
  registries.add(stores);

  return (key: K): WatchStore<T> => {
    const existing = stores.get(key);

    if (existing !== undefined) return existing;
    const created = new WatchStore(() => open(key));
    stores.set(key, created);

    return created;
  };
}

const nothing = (): (() => void) => () => undefined;

const none = (): undefined => undefined;

/**
 * The latest value a shared watch yielded, kept open while mounted: the one
 * wrapper over a connection's `AsyncIterable`s. `undefined` until the first
 * yield, or when there is no store.
 */
export function useWatch<T>(store: WatchStore<T> | undefined): T | undefined {
  return useSyncExternalStore(
    store?.subscribe ?? nothing,
    store?.getValue ?? none,
    store?.getValue ?? none,
  );
}

/** Whether a connect failed because another host than the pinned one answered. */
export function hostChanged(cause: unknown): boolean {
  return cause instanceof SdkError && cause.code === "stale";
}

/** Fixed copy for a failed connect or request; host text stays in diagnostics. */
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

/** The host view: link state, catalog generation, settings, authority. */
export const hostWatch = watchFamily((_key: "host"): AsyncIterable<HostView> =>
  connection().watch(),
);

/** The whole session directory, roots and children: the sidebar and its working marks. */
export const directoryWatch = watchFamily((_key: "all"): AsyncIterable<readonly SessionInfo[]> =>
  connection().sessions.watch({ parents: { kind: "all" } }),
);

/** One session's children, as the directory lists them. */
export const childrenWatch = watchFamily(
  (session: SessionId): AsyncIterable<readonly SessionInfo[]> =>
    connection().sessions.watch({ parents: { kind: "children", session } }),
);

/** One session's main head as a view: the transcript, execution, changes, catalog. */
export const sessionWatch = watchFamily((session: SessionId): AsyncIterable<SessionView> =>
  connection().session(session).watch(),
);

/** One workspace's jobs as they change. */
export const jobsWatch = watchFamily((workspace: WorkspaceId): AsyncIterable<readonly JobView[]> =>
  connection().workspace(workspace).jobs.watch(),
);

/** One workspace's git status as it changes; a workspace without git yields nothing. */
export const gitStatusWatch = watchFamily((workspace: WorkspaceId): AsyncIterable<GitStatus> =>
  (async function* () {
    const git = await connection().workspace(workspace).git();

    if (git.kind === "available") yield* git.api.watch();
  })(),
);
