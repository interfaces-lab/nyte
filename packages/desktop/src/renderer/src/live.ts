/**
 * The live overlay store and watch for one open session. The rules live in
 * `live-fold.ts`; this file is transport: a store per session, one watch per
 * mount, and a resume path for a watch that ends.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Seq, SessionEvent, SessionId, SessionSnapshot } from "@nyte-ai/core";
import { foldEvent, IDLE, resumeFrom } from "./live-fold.ts";
import type { LiveSnapshot } from "./live-fold.ts";
import { loadThread, refreshThread } from "./queries.ts";
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
  snapshot: LiveSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private frame: number | undefined;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LiveSnapshot => this.snapshot;

  update(next: LiveSnapshot): void {
    this.snapshot = next;
    this.frame ??= window.requestAnimationFrame(() => {
      this.frame = undefined;
      for (const listener of this.listeners) listener();
    });
  }
}

function fold(store: LiveStore, sessionId: SessionId, event: SessionEvent): void {
  const result = foldEvent(store.snapshot, event);
  if (result.snapshot !== store.snapshot) store.update(result.snapshot);
  if (result.refreshAt !== undefined) refreshThread(sessionId, result.refreshAt);
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
    const { sessionId: watchedSessionId, seq } = latched;
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
      const delay = Math.min(250 * 2 ** failures, 4_000);
      failures += 1;
      reconnectTimer = window.setTimeout(() => void resume(), delay);
    };

    const resume = async (): Promise<void> => {
      let snapshot: SessionSnapshot;
      try {
        snapshot = await loadThread(watchedSessionId);
      } catch {
        scheduleResume();
        return;
      }
      if (stopped) return;
      watchCursor = snapshot.seq;
      watchedStore.update(resumeFrom(watchedStore.snapshot, snapshot.run));
      connect();
    };

    const connect = (): void => {
      if (stopped) return;
      disposeWatch = nyte.watch(
        { sessionId: watchedSessionId, afterSeq: watchCursor },
        (event) => {
          failures = 0;
          watchCursor = event.seq;
          fold(watchedStore, watchedSessionId, event);
        },
        scheduleResume,
      );
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      disposeWatch?.();
      watchedStore.update({ ...IDLE, diagnostics: watchedStore.snapshot.diagnostics });
    };
  }, [latched]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

interface LiveCursor {
  readonly sessionId: SessionId;
  readonly seq: Seq;
}

const stores = new Map<string, LiveStore>();

function storeFor(sessionId: SessionId): LiveStore {
  const existing = stores.get(sessionId);
  if (existing !== undefined) return existing;
  const created = new LiveStore();
  stores.set(sessionId, created);
  return created;
}
