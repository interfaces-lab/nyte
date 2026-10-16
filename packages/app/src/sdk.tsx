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

export class WatchStore<T> {
  value: T | undefined = undefined;
  error: Error | undefined = undefined;
  private readonly listeners = new Set<() => void>();
  private stop: (() => void) | undefined;
  private readonly open: () => AsyncIterable<T>;
  private readonly idle: () => void;

  constructor(open: () => AsyncIterable<T>, idle: () => void = () => undefined) {
    this.open = open;
    this.idle = idle;
  }

  get active(): boolean {
    return this.listeners.size > 0;
  }

  dispose(): void {
    this.stop?.();
    this.stop = undefined;
    this.value = undefined;
    this.error = undefined;
    this.notify();
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
        this.idle();
      });
    };
  };

  getValue = (): T | undefined => this.value;

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

const none = (): undefined => undefined;

export function useWatch<T>(store: WatchStore<T> | undefined): T | undefined {
  return useSyncExternalStore(
    store?.subscribe ?? nothing,
    store?.getValue ?? none,
    store?.getValue ?? none,
  );
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
