import { asId } from "@nyte-ai/schema";
import { pagedViews, sdk, SdkError, tracePaints } from "@nyte-ai/sdk";
import type {
  ConnectOptions,
  Connection,
  CredentialSource,
  GitStatus,
  HostId,
  HostView,
  JobView,
  McpView,
  PagedViews,
  PartId,
  PartView,
  SessionId,
  SessionInfo,
  SessionView,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { startupReadsReleased } from "./startup.ts";
import { countWork } from "./work-counts.ts";
import { sessionActivityProjector } from "./conversation/session-activity.ts";
import type { LoadedSessionView } from "./conversation/session-activity.ts";
import { createTextPacer } from "./conversation/paced-text.ts";

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

const visibleTranscripts = new Map<SessionId, number>();

export function showTranscript(session: SessionId): () => void {
  visibleTranscripts.set(session, (visibleTranscripts.get(session) ?? 0) + 1);

  return () => {
    const count = visibleTranscripts.get(session) ?? 1;

    if (count === 1) visibleTranscripts.delete(session);
    else visibleTranscripts.set(session, count - 1);
  };
}

const pagers = new Map<SessionId, PagedViews>();

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function keepItem<T>(shown: T | undefined, next: T): T {
  return shown !== undefined && JSON.stringify(shown) === JSON.stringify(next) ? shown : next;
}

function keepItems<T>(
  shown: readonly T[],
  next: readonly T[],
  key: (item: T) => string,
): readonly T[] {
  const known = new Map(shown.map((item) => [key(item), item]));
  const items = next.map((item) => keepItem(known.get(key(item)), item));

  return items.length === shown.length && items.every((item, index) => item === shown[index])
    ? shown
    : items;
}

function keepShown(shown: SessionView, next: SessionView): SessionView {
  return {
    ...next,
    messages: keepItems(shown.messages, next.messages, (message) => message.id),
    queue: keepItems(shown.queue, next.queue, (message) => message.id),
    leadingPrompt: keepItem(shown.leadingPrompt, next.leadingPrompt),
    turns: keepItems(shown.turns, next.turns, (turn) => turn.id),
    changes: keepItems(shown.changes, next.changes, (change) => change.path),
  };
}

export const sessionWatch = watchFamily(
  (current, session: SessionId): AsyncIterable<LoadedSessionView> => {
    return {
      [Symbol.asyncIterator]() {
        const views = pagedViews(current.session(session), { tail: OPENING_TAIL });
        const iterator = tracePaints(views, session, nextFrame)[Symbol.asyncIterator]();
        const activity = sessionActivityProjector();

        const pacer = createTextPacer<LoadedSessionView>(
          () => visibleTranscripts.has(session),
          (view) => sessionWatch(session).revise(view),
        );

        pagers.set(session, views);
        let first = true;

        return {
          async next() {
            const next = await iterator.next();

            if (next.done === true) return next;
            countWork(`publish:view:${session}`);

            let view = next.value;

            if (first) {
              first = false;
              const shown = sessionWatch(session).value;

              if (shown !== undefined) view = keepShown(shown, view);
            }

            return { done: false, value: pacer.receive({ ...view, activity: activity(view) }) };
          },
          async return() {
            pacer.dispose();

            if (pagers.get(session) === views) pagers.delete(session);
            await iterator.return?.();

            return { done: true, value: undefined };
          },
        };
      },
    };
  },
);

const partWatches = watchFamily((current, key: string): AsyncIterable<PartView | null> => {
  const [session = "", part = ""] = key.split(" ");

  return current.session(asId<"session">(session)).part(asId<"part">(part)).watch();
});

/** One part, live wherever it sits in its chat, even past the messages the chat's view holds. */
export function partWatch(session: SessionId, part: PartId): WatchStore<PartView | null> {
  return partWatches(`${session} ${part}`);
}

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

export const mcpWatch = watchFamily((current, workspace: WorkspaceId): AsyncIterable<McpView> =>
  current.workspace(workspace).mcp.watch(),
);

export const gitStatusWatch = watchFamily(
  (current, workspace: WorkspaceId): AsyncIterable<GitStatus> =>
    (async function* () {
      await startupReadsReleased();
      const git = await current.workspace(workspace).git();

      if (git.kind === "available") yield* git.api.watch();
    })(),
);
