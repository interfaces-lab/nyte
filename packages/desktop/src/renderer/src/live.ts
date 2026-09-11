/**
 * The live overlay store and watch for one open session. The rules live in
 * `live-fold.ts`; this file owns transport and presentation acknowledgement
 * against the snapshot cache, including the resume path for a watch that ends.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Seq, SessionEvent, SessionId, SessionSnapshot } from "@nyte-ai/core";
import type { LiveParts } from "@nyte-ai/core/views";
import { foldState, IDLE, projectLive, resumeFrom } from "./live-fold.ts";
import type { LiveSnapshot, LiveState } from "./live-fold.ts";
import { keys, loadThread, queryClient, refreshThread } from "./queries.ts";
import { requestTrust } from "./chrome/open-workspace.tsx";
import { nyte } from "./nyte.ts";

export { livePartKey } from "./live-fold.ts";
export type {
  LiveDiagnostic,
  LivePartRef,
  LiveRunState,
  LiveSnapshot,
  LiveToolProgress,
} from "./live-fold.ts";

class LiveStore {
  private snapshot: LiveSnapshot = IDLE;
  private current: LiveState = IDLE;
  private dirty = false;
  private retained: RetainedParts[] = [];
  private readonly listeners = new Set<() => void>();
  private frame: number | undefined;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // Reads remain synchronous, but normal watch bursts derive once at the frame.
  getSnapshot = (): LiveSnapshot => {
    if (!this.dirty) return this.snapshot;
    this.dirty = false;
    const parts =
      this.retained.length === 0
        ? this.current.parts
        : [...this.retained.flatMap((item) => item.parts), ...this.current.parts];
    this.snapshot = projectLive(this.snapshot, this.current, parts);
    return this.snapshot;
  };

  fold(event: SessionEvent, durable: SessionSnapshot | undefined): Seq | undefined {
    const previous = this.current;
    const result = foldState(previous, event);
    if (event.kind === "commit" && result.snapshot.parts !== this.current.parts) {
      const remaining = new Set(result.snapshot.parts);
      this.retained.push({
        seq: event.seq,
        head: event.head,
        commit: event.item.oid,
        parts: this.current.parts.filter((part) => !remaining.has(part)),
      });
    }
    this.current = result.snapshot;
    if (event.kind === "commit") this.acknowledge(durable);
    if (this.current !== previous) this.publish();
    return result.refreshAt;
  }

  acknowledge(durable: SessionSnapshot | undefined): void {
    if (durable === undefined || this.retained.length === 0) return;
    const remaining = this.retained.filter((item) => !covers(durable, item));
    if (remaining.length === this.retained.length) return;
    this.retained = remaining;
    this.publish();
  }

  reset(run: SessionSnapshot["run"]): void {
    this.retained = [];
    this.current = resumeFrom(this.current, run);
    this.publish();
  }

  dispose(): void {
    if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.retained = [];
    this.current = resumeFrom(this.current, undefined);
    this.dirty = true;
    this.getSnapshot();
    for (const listener of this.listeners) listener();
  }

  private publish(): void {
    this.dirty = true;
    this.frame ??= window.requestAnimationFrame(() => {
      this.frame = undefined;
      this.getSnapshot();
      for (const listener of this.listeners) listener();
    });
  }
}

interface RetainedParts {
  readonly seq: Seq;
  readonly head: SessionSnapshot["head"];
  readonly commit: NonNullable<SessionSnapshot["tip"]>;
  readonly parts: LiveParts;
}

function covers(snapshot: SessionSnapshot, retained: RetainedParts): boolean {
  if (snapshot.head !== retained.head) return false;
  if (snapshot.seq >= retained.seq || snapshot.tip === retained.commit) return true;
  // The SDK reads seq first, so the transcript can be ahead of that cursor.
  return snapshot.transcript.some((turn) =>
    turn.kind === "turn"
      ? turn.id === retained.commit ||
        turn.parts.some((part) =>
          part.kind === "tool"
            ? part.result?.commit === retained.commit
            : part.commit === retained.commit,
        )
      : turn.commit === retained.commit,
  );
}

function fold(store: LiveStore, sessionId: SessionId, event: SessionEvent): void {
  if (event.kind === "activation_changed") {
    requestTrust(event.activation);
    return;
  }
  if (event.kind === "job" || event.kind === "synced") {
    void queryClient.invalidateQueries({ queryKey: keys.jobs(sessionId) });
  }
  const refreshAt = store.fold(
    event,
    queryClient.getQueryData<SessionSnapshot>(keys.snapshot(sessionId)),
  );
  if (refreshAt !== undefined) refreshThread(sessionId, refreshAt);
  if (
    event.kind === "fact" ||
    event.kind === "plugins_changed" ||
    event.kind === "status_changed"
  ) {
    void queryClient.invalidateQueries({ queryKey: keys.pluginSettings(sessionId), exact: true });
    void queryClient.invalidateQueries({ queryKey: ["customize", sessionId], exact: true });
    void queryClient.invalidateQueries({ queryKey: keys.pluginCatalog, exact: true });
  }
  if (event.kind === "commit" || event.kind === "effect" || event.kind === "tool_progress") {
    void queryClient.invalidateQueries({ queryKey: keys.children(sessionId), exact: true });
  }
}

/**
 * One live watch for one open session. The core snapshot's seq is the replay
 * cursor, so commits between the read and subscription cannot be lost. A
 * watch that ends resumes from a fresh snapshot: its cursor may be below the
 * stream floor, and a snapshot's seq is the one cursor the SDK never refuses.
 */
export function useSessionLive(sessionId: SessionId, afterSeq: Seq | undefined): LiveSnapshot {
  const store = storeFor(sessionId);
  // Latch the first coherent cursor per session. Later snapshot refreshes must
  // not restart the live stream and drop ephemeral frames, so the stream keys
  // on this latch rather than on `afterSeq`.
  const [cursor, setCursor] = useState<LiveCursor | undefined>(undefined);
  const latched = cursor?.sessionId === sessionId ? cursor : undefined;
  if (latched === undefined && afterSeq !== undefined) setCursor({ sessionId, seq: afterSeq });

  useEffect(() => {
    if (latched === undefined) return undefined;
    return watchSessionLive(latched.sessionId, latched.seq).dispose;
  }, [latched]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Consumers share transport and acknowledgement; the last release stops the watch. */
export function watchSessionLive(watchedSessionId: SessionId, seq: Seq) {
  let shared = watches.get(watchedSessionId);
  if (shared === undefined) {
    shared = { watch: startSessionLive(watchedSessionId, seq), consumers: 0 };
    watches.set(watchedSessionId, shared);
  }
  const owned = shared;
  owned.consumers += 1;
  let disposed = false;
  return {
    subscribe: owned.watch.subscribe,
    getSnapshot: owned.watch.getSnapshot,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      owned.consumers -= 1;
      if (owned.consumers !== 0) return;
      watches.delete(watchedSessionId);
      owned.watch.dispose();
    },
  };
}

const watches = new Map<
  SessionId,
  {
    watch: ReturnType<typeof startSessionLive>;
    consumers: number;
  }
>();

function startSessionLive(watchedSessionId: SessionId, seq: Seq) {
  const watchedStore = storeFor(watchedSessionId);
  let stopped = false;
  let reconnectTimer: number | undefined;
  let disposeWatch: (() => void) | undefined;
  let watchCursor = seq;
  let failures = 0;

  const scheduleResume = (): void => {
    if (stopped) return;
    disposeWatch?.();
    disposeWatch = undefined;
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    const delay = Math.min(250 * 2 ** failures, 4_000);
    failures += 1;
    reconnectTimer = window.setTimeout(() => void resume(), delay);
  };

  const resume = async (): Promise<void> => {
    reconnectTimer = undefined;
    if (stopped) return;
    let snapshot: SessionSnapshot;
    try {
      snapshot = await loadThread(watchedSessionId);
    } catch {
      scheduleResume();
      return;
    }
    if (stopped) return;
    watchCursor = snapshot.seq;
    watchedStore.reset(snapshot.run);
    void queryClient.invalidateQueries({
      queryKey: keys.pluginSettings(watchedSessionId),
      exact: true,
    });
    void queryClient.invalidateQueries({
      queryKey: ["customize", watchedSessionId],
      exact: true,
    });
    connect();
  };

  const connect = (): void => {
    if (stopped) return;
    disposeWatch = nyte.watch(
      { sessionId: watchedSessionId, afterSeq: watchCursor },
      (event) => {
        if (stopped) return;
        failures = 0;
        watchCursor = event.seq;
        fold(watchedStore, watchedSessionId, event);
      },
      scheduleResume,
    );
  };

  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (event.query.queryKey[0] !== "snapshot" || event.query.queryKey[1] !== watchedSessionId)
      return;
    watchedStore.acknowledge(
      queryClient.getQueryData<SessionSnapshot>(keys.snapshot(watchedSessionId)),
    );
  });
  connect();
  return {
    subscribe: watchedStore.subscribe,
    getSnapshot: watchedStore.getSnapshot,
    dispose: () => {
      stopped = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      disposeWatch?.();
      unsubscribeCache();
      watchedStore.dispose();
    },
  };
}

interface LiveCursor {
  readonly sessionId: SessionId;
  readonly seq: Seq;
}

const stores = new Map<SessionId, LiveStore>();

function storeFor(sessionId: SessionId): LiveStore {
  const existing = stores.get(sessionId);
  if (existing !== undefined) return existing;
  const created = new LiveStore();
  stores.set(sessionId, created);
  return created;
}
