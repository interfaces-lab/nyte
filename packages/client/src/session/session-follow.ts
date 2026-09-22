/**
 * Keeps a `SessionState` current for one head and tells subscribers when it
 * changed: one snapshot, then `watch` from the snapshot's seq, refolded with
 * `foldEvent`. Ordinary events fold locally. A rebase, one full snapshot,
 * happens on structural change or recovery: the fold cannot apply an event, a
 * watch fails (including a cursor older than the event floor; design record,
 * "Events and views"), or a head moved without the commits to follow. The
 * observer owns bootstrap and recovery: a failed read is reported and retried
 * until it succeeds or `close`. Session metadata (the session row, effective
 * inputs, context) is core's projection; it is re-read through the narrow
 * `sessions.metadata` after the events that change it, coalesced so a batch
 * of events costs one store round trip that never delays a fold.
 *
 * Based on https://github.com/earendil-works/pi/blob/71dca871/packages/agent/src/harness/events.ts
 * (the buffered watcher: subscribe with cleanup, isolated listener failures,
 * a read that replaces the snapshot while the event stream keeps folding) and
 * https://github.com/earendil-works/pi/blob/71dca871/packages/coding-agent/src/experimental/services/transcript-provider.ts
 * (rebase only on structural change). Synced with pi 71dca871.
 */
import type { HeadName, RemoteNyte, RunId, SessionEvent, SessionId } from "@nyte-ai/protocol";
import {
  foldEvent,
  stateFromSnapshot,
  stateWithMetadata,
  tipMismatch,
  type SessionState,
} from "./session-state.ts";

export type SessionUpdate = {
  readonly state: SessionState;
  /** A selected-inputs read still matches this request/ack version. */
  readonly selectedVersion: number | undefined;
} &
  /** A full read replaced the state: bootstrap, recovery, or a structural change. */
  (
    | { readonly kind: "snapshot" }
    /** Session metadata re-read after events, without a new event. */
    | { readonly kind: "metadata" }
    /** This client asked the run to stop; the store's flag has not arrived yet. */
    | { readonly kind: "stop" }
    | { readonly kind: "event"; readonly event: SessionEvent }
  );

/** What the observer reads and watches: a bridge that carries only these still qualifies. */
export interface SessionObserverClient {
  readonly sessions: Pick<RemoteNyte["sessions"], "snapshot" | "metadata">;
  readonly watch: RemoteNyte["watch"];
}

export interface SessionObserverOptions {
  readonly sessionId: SessionId;
  readonly head?: HeadName;
  /** A read or watch failed, or a subscriber threw; the observer keeps going. */
  readonly onError?: (error: Error) => void;
  readonly retryMs?: number;
  /** Changes whenever local selection is requested or core acknowledges it. */
  readonly selectionVersion?: () => number;
}

const DEFAULT_RETRY_MS = 500;

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Session metadata is re-read after the events that can change it; text and
 * progress never do. A queued or cancelled choice moves the selected inputs
 * without a commit, so those queue events count.
 */
function touchesMetadata(event: SessionEvent): boolean {
  switch (event.kind) {
    case "commit":
    case "run":
    case "head_moved":
    case "stack":
    case "fact":
    case "config_queued":
    case "queue_cancelled":
      return true;
    case "activation_changed":
    case "compaction":
    case "queued":
    case "landed":
    case "effect":
    case "text_delta":
    case "reasoning_delta":
    case "tool_progress":
    case "deleted":
    case "job":
    case "synced":
    case "diagnostic":
    case "plugins_changed":
    case "notification":
    case "status_changed":
      return false;
    default: {
      const _exhaustive: never = event;

      return _exhaustive;
    }
  }
}

export class SessionObserver {
  private readonly nyte: SessionObserverClient;
  private readonly options: SessionObserverOptions;
  private readonly listeners = new Set<(update: SessionUpdate) => void>();
  private current: SessionState | undefined;
  /** The running watch loop's own stop; replaced by every rebase. */
  private loop: AbortController | undefined;
  private closed = false;
  private selectedRead = 0;
  private appliedSelectedRead = 0;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Events since the last metadata read; one read is in flight at a time. */
  private metadataDirty = false;
  private metadataRefreshing = false;
  /** Counts full snapshots; a metadata read started before one is stale when it lands. */
  private snapshots = 0;

  constructor(nyte: SessionObserverClient, options: SessionObserverOptions) {
    this.nyte = nyte;
    this.options = options;
  }

  /** The same object until an update replaces it; `undefined` before the first snapshot. */
  get state(): SessionState | undefined {
    return this.current;
  }

  /** Every update after this call, until the returned function runs or the observer closes. */
  subscribe(listener: (update: SessionUpdate) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Resolves with the first snapshot and keeps watching until `close`. A
   * failed first read is reported and retried; the promise rejects only when
   * the observer closes, or another rebase supersedes it, before a read lands.
   */
  start(): Promise<SessionState> {
    return this.rebase();
  }

  /** Throw the local state away and read it again; the watch resumes from the new seq. */
  resync(): Promise<SessionState> {
    return this.rebase();
  }

  /** Re-read session metadata onto the current state, without replacing the transcript. */
  refresh(): void {
    if (this.loop !== undefined) this.markMetadataDirty(this.loop);
  }

  /** Stop drawing the run now; frames still in flight for it are dropped. `resync` undoes a failed request. */
  requestStop(runId: RunId): void {
    const state = this.current;

    if (
      state?.run === undefined ||
      state.run.runId !== runId ||
      state.run.abortRequested === true
    ) {
      return;
    }

    const next: SessionState = { ...state, run: { ...state.run, abortRequested: true } };
    this.current = next;
    this.publish({ kind: "stop", state: next, selectedVersion: undefined });
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.loop?.abort();
    this.loop = undefined;

    if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
  }

  private rebase(): Promise<SessionState> {
    if (this.closed) return Promise.reject(new Error("The session observer is closed"));
    const loop = this.replaceLoop();

    return new Promise((resolve, reject) => {
      loop.signal.addEventListener(
        "abort",
        () => reject(new Error("The session observer stopped before its snapshot landed")),
        { once: true },
      );
      void this.follow(loop, resolve);
    });
  }

  private replaceLoop(): AbortController {
    this.loop?.abort();
    const loop = new AbortController();
    this.loop = loop;
    // The next snapshot carries current metadata; a read still in flight belongs to the old loop.
    this.metadataDirty = false;
    this.metadataRefreshing = false;

    return loop;
  }

  /** A subscriber's failure is its own; the fold and the other subscribers go on. */
  private publish(update: SessionUpdate): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(update);
      } catch (cause) {
        this.options.onError?.(toError(cause));
      }
    }
  }

  // A later accepted read also rules out an older response from the same
  // local version, for example when another client changes selected inputs.
  private acceptSelected(version: number | undefined, read: number): boolean {
    if (version !== this.options.selectionVersion?.() || read < this.appliedSelectedRead)
      return false;
    this.appliedSelectedRead = read;

    return true;
  }

  private async snapshot(loop: AbortController): Promise<SessionState> {
    this.snapshots += 1;
    const version = this.options.selectionVersion?.();
    const read = ++this.selectedRead;
    const head = this.options.head;

    const snapshot = await this.nyte.sessions.snapshot(
      head === undefined
        ? { sessionId: this.options.sessionId }
        : { sessionId: this.options.sessionId, head },
    );

    if (snapshot === undefined) throw new Error(`Session not found: ${this.options.sessionId}`);
    const projected = stateFromSnapshot(snapshot);
    const relevant = !loop.signal.aborted && this.acceptSelected(version, read);

    const state =
      relevant || this.current === undefined
        ? projected
        : {
            ...projected,
            info: { ...projected.info, config: this.current.info.config },
          };

    if (loop.signal.aborted) return state;
    this.current = state;
    this.publish({ kind: "snapshot", state, selectedVersion: relevant ? version : undefined });

    // The selection moved during the read; the metadata loop reads it again.
    if (version !== this.options.selectionVersion?.()) this.markMetadataDirty(loop);

    return state;
  }

  /**
   * Each loop turn is one watch from a snapshot's seq. Leaving it means the
   * fold asked for a snapshot, the watch failed, or the store closed it;
   * either way the next turn re-reads first. Several events can share one
   * seq, so a folded event's seq is never a cursor: a failed read is retried
   * until it succeeds, never watched around.
   */
  private async follow(
    loop: AbortController,
    onFirst?: (state: SessionState) => void,
  ): Promise<void> {
    const live = (): boolean => !loop.signal.aborted;
    let cursor: number | undefined;
    let first = onFirst;

    while (live()) {
      if (cursor === undefined) {
        try {
          const state = await this.snapshot(loop);

          if (!live()) return;
          cursor = state.seq;
          first?.(state);
          first = undefined;
        } catch (cause) {
          if (!live()) return;
          this.options.onError?.(toError(cause));
          await this.pause(loop);
        }

        continue;
      }

      let resnapshot = false;

      try {
        const events = this.nyte.watch({
          sessionId: this.options.sessionId,
          afterSeq: cursor,
          signal: loop.signal,
        });

        for await (const event of events) {
          if (!live()) return;
          const state = this.current;

          if (state === undefined) return;
          const outcome = foldEvent(state, event);

          if (outcome.kind === "resnapshot") {
            resnapshot = true;
            break;
          }

          const next = outcome.state;
          this.current = next;
          this.publish({ kind: "event", state: next, event, selectedVersion: undefined });
          this.scheduleSettle(loop);

          // The read runs behind the fold so its publication never waits on the store.
          if (touchesMetadata(event)) this.markMetadataDirty(loop);
        }
      } catch (cause) {
        if (!live()) return;
        this.options.onError?.(toError(cause));
      }

      cursor = undefined;

      if (!live()) return;

      if (!resnapshot) await this.pause(loop);
    }
  }

  private markMetadataDirty(loop: AbortController): void {
    this.metadataDirty = true;

    if (this.metadataRefreshing) return;
    this.metadataRefreshing = true;
    void this.refreshMetadata(loop);
  }

  /**
   * Re-read session metadata onto the current state while `loop` is the
   * running one. Events marking the head dirty during a read queue exactly
   * one more; so does a selection that moved under the read. A failed read
   * reports and retries after `retryMs`.
   */
  private async refreshMetadata(loop: AbortController): Promise<void> {
    const live = (): boolean => this.loop === loop;

    while (live() && this.metadataDirty) {
      this.metadataDirty = false;
      const version = this.options.selectionVersion?.();
      const read = ++this.selectedRead;
      const head = this.current?.head;

      if (head === undefined) break;
      const generation = this.snapshots;

      try {
        const metadata = await this.nyte.sessions.metadata({
          sessionId: this.options.sessionId,
          head,
        });

        if (!live()) return;

        // A full snapshot or a newer event overtook this read; the loop reads again.
        if (generation !== this.snapshots || this.metadataDirty) continue;

        if (metadata === undefined) throw new Error(`Session not found: ${this.options.sessionId}`);
        const state = this.current;

        if (state === undefined) break;
        const relevant = this.acceptSelected(version, read);
        const next = stateWithMetadata(state, metadata, relevant);
        this.current = next;
        this.publish({
          kind: "metadata",
          state: next,
          selectedVersion: relevant ? version : undefined,
        });

        if (!relevant && version !== this.options.selectionVersion?.()) this.metadataDirty = true;
      } catch (cause) {
        if (!live()) return;
        this.options.onError?.(toError(cause));
        this.metadataDirty = true;
        await this.pause(loop);
      }
    }

    if (live()) this.metadataRefreshing = false;
  }

  /**
   * A moved head is followed by the commits that moved it, in one batch of
   * events the projection yields together. Check for a tip that never
   * arrived on a later tick, after the batch has been consumed.
   */
  private scheduleSettle(loop: AbortController): void {
    if (this.settleTimer !== undefined || this.current === undefined || !tipMismatch(this.current))
      return;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      const state = this.current;

      if (loop.signal.aborted || state === undefined || !tipMismatch(state)) return;
      // An automatic rebase has no caller waiting for a snapshot promise.
      void this.follow(this.replaceLoop());
    }, 0);
  }

  private pause(loop: AbortController): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const done = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        loop.signal.removeEventListener("abort", done);
        resolve();
      };

      timer = setTimeout(done, this.options.retryMs ?? DEFAULT_RETRY_MS);
      loop.signal.addEventListener("abort", done, { once: true });
    });
  }
}
