/**
 * One shared `SessionObserver` per open session, counted by its consumers,
 * and the renderer's reads of it. Core owns the fold, recovery, and cursors;
 * this file publishes the observer's state where the interface reads it. The
 * durable part goes into the snapshot query cache the moment it changes and
 * the overlay is derived from the same state, so a settled part never leaves
 * the overlay before its row is in the transcript. Events, and the rebases
 * that stand in for the ones they replace, also invalidate what the state
 * does not model: jobs, changed files, plugin settings, trust.
 */
import { useEffect, useSyncExternalStore } from "react";
import { sessionId } from "@nyte-ai/protocol";
import type {
  RunId,
  Seq,
  SessionEvent,
  SessionId,
  SessionInfo,
  SessionSnapshot,
} from "@nyte-ai/protocol";
import { isTerminalPhase, SessionObserver, snapshotOf } from "@nyte-ai/client";
import type { SessionState, SessionUpdate } from "@nyte-ai/client";
import { IDLE, projectLive } from "./live-fold.ts";
import type { LiveSnapshot } from "./live-fold.ts";
import {
  backgroundJobsOptions,
  cacheSessionInfo,
  childSessionsOptions,
  keys,
  mentionFilesOptions,
  queryClient,
  refreshVcs,
  SNAPSHOT_WARM_MS,
} from "./queries.ts";
import type { SessionSelection } from "./session-configuration.ts";
import { requestTrust } from "./chrome/open-workspace.tsx";
import { nyte, sessionClient } from "./nyte.ts";
import { outbox } from "./use-outbox.ts";
import { watchSessionInfo } from "./session-info-watch.ts";

export { livePartKey } from "./live-fold.ts";

export type { LivePartRef, LiveRunState, LiveSnapshot, LiveToolProgress } from "./live-fold.ts";

const RETRY_MS = 1_000;

/** What a snapshot reader can see. `seq` and the overlay move with every delta and are not among it. */
function durableChanged(previous: SessionState | undefined, next: SessionState): boolean {
  return (
    previous === undefined ||
    previous.info !== next.info ||
    previous.head !== next.head ||
    previous.config !== next.config ||
    previous.context !== next.context ||
    previous.transcript !== next.transcript ||
    previous.pending !== next.pending ||
    previous.run !== next.run ||
    previous.compaction !== next.compaction ||
    previous.parked !== next.parked
  );
}

interface SessionFrame {
  readonly snapshot: SessionSnapshot;
  readonly live: LiveSnapshot;
}

class LiveStore {
  private snapshot: LiveSnapshot = IDLE;
  private projection: { readonly state: SessionState; readonly frame: SessionFrame } | undefined;
  private state: SessionState | undefined;
  private dirty = false;
  private frame: number | undefined;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
      scheduleStoreRelease(this);
    };
  };

  hasListeners(): boolean {
    return this.listeners.size !== 0;
  }

  // Reads remain synchronous, but a burst of deltas notifies once at the frame.
  getSnapshot = (): LiveSnapshot => {
    if (!this.dirty) return this.snapshot;
    this.dirty = false;
    this.snapshot =
      this.state === undefined
        ? IDLE
        : projectLive(this.snapshot, this.state.overlay, this.state.run);

    return this.snapshot;
  };

  getFrame = (): SessionFrame | undefined => {
    const state = this.state;

    if (state === undefined) return undefined;

    if (this.projection?.state !== state) {
      this.projection = {
        state,
        frame: { snapshot: snapshotOf(state), live: this.getSnapshot() },
      };
    }

    return this.projection.frame;
  };

  /** The durable part reaches the cache now; the overlay wakes its readers at the next frame. */
  update(sessionId: SessionId, state: SessionState): void {
    const previous = this.state;
    this.state = state;
    this.dirty = true;

    if (durableChanged(previous, state)) {
      queryClient.setQueryData(keys.snapshot(sessionId), snapshotOf(state));

      if (previous?.info !== state.info) cacheSessionInfo(state.info);
    }

    this.frame ??= window.requestAnimationFrame(() => {
      this.frame = undefined;
      this.notify();
    });
  }

  /** The overlay is gone the moment the observation ends, before any reader asks. */
  reset(): void {
    if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.state = undefined;
    this.projection = undefined;
    this.snapshot = IDLE;
    this.dirty = false;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

interface SharedObserver {
  readonly observer: SessionObserver;
  readonly store: LiveStore;
  consumers: number;
  /** Readers waiting on a snapshot; a failed read answers them so a query can show it. */
  readonly failures: Set<(error: Error) => void>;
  /** Runs when the observation stops, for a read or acknowledgement that can no longer land. */
  readonly closing: Set<() => void>;
}

const observers = new Map<SessionId, SharedObserver>();

const stores = new Map<SessionId, LiveStore>();

const selectionVersions = new Map<SessionId, number>();

function scheduleStoreRelease(store: LiveStore): void {
  queueMicrotask(() => {
    for (const [sessionId, candidate] of stores) {
      if (candidate !== store) continue;

      if (!observers.has(sessionId) && !store.hasListeners()) stores.delete(sessionId);

      return;
    }
  });
}

function storeFor(sessionId: SessionId): LiveStore {
  const existing = stores.get(sessionId);

  if (existing !== undefined) return existing;
  const created = new LiveStore();
  stores.set(sessionId, created);

  return created;
}

/**
 * What the state does not model, and the trust prompt an activation change
 * needs. Without an event, for a rebase: core leaves the watch the moment the
 * fold cannot apply an event, so that event never reaches a subscriber and
 * everything queued behind it is dropped with the subscription. The fresh
 * state says what the session holds now but not what changed on the way, and
 * no later event repeats it, so a rebase answers for all of them.
 *
 * Every branch below answers for a rebase as well. A condition added here
 * without its `rebase ||` silently reintroduces the loss this repairs.
 */
function react(sessionId: SessionId, state: SessionState, event: SessionEvent | undefined): void {
  const rebase = event === undefined;

  if (event?.kind === "activation_changed") requestTrust(state.info.activation);

  if (rebase || event.kind === "job" || event.kind === "synced") {
    void queryClient.invalidateQueries({ queryKey: keys.jobs(sessionId) });
  }

  const completedTool =
    event?.kind === "commit" &&
    event.item.commit.body.kind === "message" &&
    event.item.commit.body.message.role === "toolResult";

  const completedRun = event?.kind === "run" && isTerminalPhase(event.run.phase);

  // A failed tool or aborted run can still have written files. Run completion
  // also covers a tool that ended without committing a result.
  if (rebase || completedTool || completedRun) refreshVcs();

  if (
    rebase ||
    event.kind === "fact" ||
    event.kind === "plugins_changed" ||
    event.kind === "status_changed"
  ) {
    void queryClient.invalidateQueries({ queryKey: keys.pluginSettings(sessionId), exact: true });
    void queryClient.invalidateQueries({ queryKey: ["customize", sessionId], exact: true });
    void queryClient.invalidateQueries({ queryKey: keys.pluginCatalog, exact: true });
  }

  if (rebase || event.kind === "commit" || event.kind === "effect") {
    void queryClient.invalidateQueries({ queryKey: keys.children(sessionId), exact: true });
    void queryClient.invalidateQueries({ queryKey: keys.childSessions(sessionId), exact: true });
  }
}

function observe(sessionId: SessionId): SharedObserver {
  const existing = observers.get(sessionId);

  if (existing !== undefined) return existing;
  const store = storeFor(sessionId);
  const failures = new Set<(error: Error) => void>();

  const observer = new SessionObserver(sessionClient, {
    sessionId,
    retryMs: RETRY_MS,
    selectionVersion: () => selectionVersions.get(sessionId) ?? 0,
    onError: (error) => {
      // A waiter removes itself when told; iterate a copy so the set can change underneath.
      for (const fail of Array.from(failures)) fail(error);
    },
  });

  // The observer publishes a snapshot for its first read, and again whenever
  // the fold gives up or a watch dies. Its cursor says which of those owes
  // anything: a snapshot past the newest seq this observation has seen holds
  // events that never arrived as events, so their side effects are still due.
  // A recovery retry re-reads the same cursor and owes nothing — reacting to
  // it would rescan the workspace once a second for as long as a watch stays
  // dead, and each scan cancels the last rather than finishing.
  let reacted: Seq | undefined;
  observer.subscribe((update) => {
    store.update(sessionId, update.state);
    outbox.observe(update);

    if (update.kind === "snapshot") requestTrust(update.state.info.activation);
    const seen = reacted;
    reacted = update.state.seq;

    if (update.kind === "event") {
      react(sessionId, update.state, update.event);

      return;
    }

    if (update.kind === "snapshot" && seen !== undefined && update.state.seq > seen) {
      react(sessionId, update.state, undefined);
    }
  });
  const shared: SharedObserver = { observer, store, consumers: 0, failures, closing: new Set() };
  observers.set(sessionId, shared);
  // The observer reports and retries a failed read itself; rejection only means the observation stopped.
  void observer.start().catch(() => undefined);

  return shared;
}

/**
 * The state of the next update `accept` takes. A failed read or the
 * observation closing rejects first, so a reader can show it; so does
 * `signal`, for a query cancelled before the read lands.
 */
function nextUpdate(
  shared: SharedObserver,
  accept: (update: SessionUpdate) => boolean,
  signal?: AbortSignal,
): Promise<SessionState> {
  return new Promise((resolve, reject) => {
    const done = (): void => {
      stop();
      shared.failures.delete(fail);
      shared.closing.delete(close);
      signal?.removeEventListener("abort", abort);
    };

    const stop = shared.observer.subscribe((update) => {
      if (!accept(update)) return;
      done();
      resolve(update.state);
    });

    const fail = (error: Error): void => {
      done();
      reject(error);
    };

    const close = (): void => fail(new Error("The session is no longer observed"));
    const abort = (): void => fail(new Error("The snapshot read was cancelled"));
    shared.failures.add(fail);
    shared.closing.add(close);
    signal?.addEventListener("abort", abort, { once: true });

    if (signal?.aborted) abort();
  });
}

/** The observer's state, or its first snapshot. */
function ready(shared: SharedObserver, signal?: AbortSignal): Promise<SessionState> {
  const state = shared.observer.state;

  return state === undefined ? nextUpdate(shared, () => true, signal) : Promise.resolve(state);
}

/** One fresh read: the next full snapshot after asking for one, whichever rebase lands it. */
function reload(shared: SharedObserver): Promise<SessionState> {
  if (shared.observer.state === undefined) return ready(shared);
  const landed = nextUpdate(shared, (update) => update.kind === "snapshot");
  // A superseding rebase publishes the snapshot this waits for; only close or failure ends it.
  void shared.observer.resync().catch(() => undefined);

  return landed;
}

/** Consumers share one observer; the last release closes it and clears the overlay. */
export function watchSessionLive(sessionId: SessionId) {
  const shared = observe(sessionId);
  shared.consumers += 1;
  let disposed = false;

  return {
    subscribe: shared.store.subscribe,
    getSnapshot: shared.store.getSnapshot,
    ready: (signal?: AbortSignal) => ready(shared, signal),
    reload: () => reload(shared),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      shared.consumers -= 1;

      if (shared.consumers !== 0) return;
      observers.delete(sessionId);
      shared.observer.close();

      for (const settle of Array.from(shared.closing)) settle();
      shared.store.reset();
      scheduleStoreRelease(shared.store);
      selectionVersions.delete(sessionId);
    },
  };
}

/** The live overlay of one open session, observed while the component is mounted. */
export function useSessionLive(sessionId: SessionId): LiveSnapshot {
  const store = storeFor(sessionId);
  useEffect(() => watchSessionLive(sessionId).dispose, [sessionId]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useChildrenLive(children: readonly SessionInfo[] | undefined): void {
  const listed = (children ?? []).map((child) => child.sessionId).join("\n");
  useEffect(() => {
    if (listed === "") return undefined;

    const watches = listed.split("\n").map((id) =>
      watchSessionInfo({
        client: nyte,
        sessionId: sessionId(id),
        onUpdate: (session) => {
          if (session !== undefined) cacheSessionInfo(session);
          else void queryClient.invalidateQueries({ queryKey: ["sessions", "children"] });
        },
      }),
    );

    return () => {
      for (const stop of watches) stop();
    };
  }, [listed]);
}

export function useSessionFrame(sessionId: SessionId): SessionFrame | undefined {
  const store = storeFor(sessionId);
  useEffect(() => watchSessionLive(sessionId).dispose, [sessionId]);

  return useSyncExternalStore(store.subscribe, store.getFrame, store.getFrame);
}

/**
 * A snapshot query reads the observer: its state when it has one, else its
 * first read, held open only until it lands. Cancelling the query releases
 * the hold at once, so a session being closed or deleted neither starts a
 * late watch nor refills a cache the cancellation removed.
 */
export async function readSessionSnapshot(
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<SessionSnapshot> {
  const lease = watchSessionLive(sessionId);

  try {
    return snapshotOf(await lease.ready(signal));
  } finally {
    lease.dispose();
  }
}

/** Force one coherent read after a mutation that needs its result; the cache holds it when this resolves. */
export async function loadThread(sessionId: SessionId): Promise<SessionSnapshot> {
  const lease = watchSessionLive(sessionId);

  try {
    return snapshotOf(await lease.reload());
  } finally {
    lease.dispose();
  }
}

/** Draw the run stopped at once; a failed request rereads the thread, then rejects. */
export async function requestStop(sessionId: SessionId, runId: RunId): Promise<void> {
  observers.get(sessionId)?.observer.requestStop(runId);

  try {
    await nyte.runs.abort({ sessionId, runId });
  } catch (cause) {
    refreshThread(sessionId);
    throw cause;
  }
}

/** A command with no event of its own may have changed files or the head: reread everything the chat shows. */
export function refreshThread(sessionId: SessionId): void {
  refreshVcs();
  void loadThread(sessionId).catch(() => undefined);
}

/**
 * Whether a cached snapshot still shows what the directory says the session
 * holds. The directory poll and live observations keep the session row
 * current, so an unchanged tip with no run means the transcript on disk is the
 * one already cached; a hover over it then costs no read at all.
 */
function snapshotMatchesSession(snapshot: SessionSnapshot, info: SessionInfo): boolean {
  const head = info.heads.find((candidate) => candidate.head === snapshot.head);

  return (
    head !== undefined &&
    head.run === undefined &&
    snapshot.run === undefined &&
    head.tip === snapshot.tip &&
    info.lastActivityAt === snapshot.session.lastActivityAt &&
    info.name === snapshot.session.name
  );
}

/**
 * Warm the durable thread frame from route intent without attaching a watch.
 * Observed sessions already own current snapshots; cached settled snapshots
 * stay valid while their directory rows still agree.
 */
export async function warmThread(sessionId: SessionId): Promise<void> {
  const auxiliaries = Promise.all([
    queryClient.prefetchQuery(childSessionsOptions(sessionId)),
    queryClient.prefetchQuery(backgroundJobsOptions(sessionId)),
    queryClient
      .fetchQuery({
        queryKey: keys.sessionCatalog(sessionId),
        queryFn: () => nyte.host.catalog({ sessionId }),
        staleTime: 15_000,
      })
      .then((catalog) => {
        if (!catalog.models.some((model) => model.fastMode.kind === "available")) return;

        return queryClient.prefetchQuery({
          queryKey: keys.pluginSettings(sessionId),
          queryFn: () => nyte.plugins.settings.list({ sessionId }),
          staleTime: SNAPSHOT_WARM_MS,
        });
      })
      .catch(() => undefined),
    queryClient.prefetchQuery(mentionFilesOptions(true)),
  ]).then(() => undefined);

  if (observers.has(sessionId)) {
    await auxiliaries;

    return;
  }

  const cached = queryClient.getQueryData<SessionSnapshot>(keys.snapshot(sessionId));
  const info = queryClient.getQueryData<SessionInfo | null>(keys.session(sessionId));

  if (cached !== undefined && info != null && snapshotMatchesSession(cached, info)) {
    await auxiliaries;

    return;
  }

  await Promise.all([
    queryClient.fetchQuery({
      queryKey: keys.snapshot(sessionId),
      queryFn: async (): Promise<SessionSnapshot> => {
        const snapshot = await sessionClient.sessions.snapshot({ sessionId });
        const observed = observers.get(sessionId)?.observer.state;

        if (observed !== undefined) return snapshotOf(observed);

        if (snapshot === undefined) throw new Error(`Session not found: ${sessionId}`);

        return snapshot;
      },
      staleTime: SNAPSHOT_WARM_MS,
    }),
    auxiliaries,
  ]);
}

/**
 * The local selection of a session's inputs. Each request and acknowledgement
 * is a new version, so the observer applies selected inputs only from reads
 * that answer the current choice; an acknowledgement waits for that read.
 */
export function sessionSelection(sessionId: SessionId): SessionSelection {
  const bump = (): number => {
    const version = (selectionVersions.get(sessionId) ?? 0) + 1;
    selectionVersions.set(sessionId, version);

    return version;
  };

  return {
    request: () => {
      bump();
    },
    acknowledge: () => {
      const version = bump();
      const shared = observers.get(sessionId);

      if (shared === undefined) {
        selectionVersions.delete(sessionId);

        return Promise.resolve();
      }

      return new Promise((resolve) => {
        const settle = (): void => {
          stop();
          shared.closing.delete(settle);
          resolve();
        };

        const stop = shared.observer.subscribe((update) => {
          if (update.selectedVersion !== undefined && update.selectedVersion >= version) settle();
        });

        shared.closing.add(settle);
        shared.observer.refresh();
      });
    },
  };
}
