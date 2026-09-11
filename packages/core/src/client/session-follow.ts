/**
 * Keeps a `SessionState` current for one head: one snapshot, then `watch`
 * from the snapshot's seq, refolded with `foldEvent`. The fold asks for a
 * new snapshot when it cannot apply an event; so does a watch that fails,
 * including a cursor older than the event floor (design record, "Events and
 * views"). A head that moved without the commits to follow settles the same
 * way once the events of that batch have all arrived. Config and context
 * are refreshed from a snapshot after run and commit events, coalesced so a
 * batch of events costs one store round trip that never delays a fold.
 */
import type { HeadName, Nyte, SessionEvent, SessionId } from "../kernel/sdk/types.ts";
import { foldEvent, stateFromSnapshot, tipMismatch, type SessionState } from "./session-state.ts";

export type SessionUpdate = {
  readonly state: SessionState;
  /** A selected-config read still matches this request/ack version. */
  readonly selectedVersion: number | undefined;
} & (
  | { readonly kind: "snapshot" }
  | { readonly kind: "selected" }
  /** Config and context re-read after events, without a new event. */
  | { readonly kind: "metadata" }
  | { readonly kind: "event"; readonly event: SessionEvent }
);

export interface SessionFollowerOptions {
  readonly sessionId: SessionId;
  readonly head?: HeadName;
  readonly onUpdate: (update: SessionUpdate) => void;
  /** A watch failed or the session disappeared; the follower retries after `retryMs`. */
  readonly onError?: (error: Error) => void;
  readonly retryMs?: number;
  /** Changes whenever local selection is requested or core acknowledges it. */
  readonly selectionVersion?: () => number;
}

const DEFAULT_RETRY_MS = 500;

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

export class SessionFollower {
  private readonly nyte: Pick<Nyte, "sessions" | "watch">;
  private readonly options: SessionFollowerOptions;
  private current: SessionState | undefined;
  /** The running watch loop's own stop; replaced by every restart. */
  private loop: AbortController | undefined;
  private closed = false;
  private selectedRead = 0;
  private appliedSelectedRead = 0;
  private selectedRetry: ReturnType<typeof setTimeout> | undefined;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Events since the last metadata read; one read is in flight at a time. */
  private metadataDirty = false;
  private metadataRefreshing = false;
  /** Counts full snapshots; a metadata read started before one is stale when it lands. */
  private snapshots = 0;

  constructor(nyte: Pick<Nyte, "sessions" | "watch">, options: SessionFollowerOptions) {
    this.nyte = nyte;
    this.options = options;
  }

  get state(): SessionState | undefined {
    return this.current;
  }

  /** Resolves with the first snapshot; the watch keeps running until `close`. */
  start(): Promise<SessionState> {
    return this.restart();
  }

  /** Throw the local state away and read it again; the watch resumes from the new seq. */
  resync(): Promise<SessionState> {
    return this.restart();
  }

  close(): void {
    this.closed = true;
    if (this.selectedRetry !== undefined) clearTimeout(this.selectedRetry);
    this.loop?.abort();
    this.loop = undefined;
    if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
  }

  private async restart(): Promise<SessionState> {
    if (this.closed) throw new Error("The session follower is closed");
    this.loop?.abort();
    const loop = new AbortController();
    this.loop = loop;
    // The new snapshot carries current metadata; a refresh still in flight belongs to the old loop.
    this.metadataDirty = false;
    this.metadataRefreshing = false;
    const state = await this.snapshot(loop);
    void this.follow(loop, state.seq);
    return state;
  }

  /** Refresh selected inputs without replacing the transcript or editor state. */
  async refreshSelected(): Promise<void> {
    const version = this.options.selectionVersion?.();
    const read = ++this.selectedRead;
    try {
      const info = await this.nyte.sessions.get({ sessionId: this.options.sessionId });
      if (this.closed || info === undefined || this.current === undefined) return;
      if (!this.acceptSelected(version, read)) {
        if (version !== this.options.selectionVersion?.()) this.retrySelected();
        return;
      }
      if (this.selectedRetry !== undefined) clearTimeout(this.selectedRetry);
      this.selectedRetry = undefined;
      this.current = { ...this.current, info: { ...this.current.info, config: info.config } };
      this.options.onUpdate({ kind: "selected", state: this.current, selectedVersion: version });
    } catch (cause) {
      if (this.closed) return;
      this.options.onError?.(toError(cause));
      this.retrySelected();
    }
  }

  private retrySelected(): void {
    if (this.selectedRetry !== undefined) return;
    this.selectedRetry = setTimeout(() => {
      this.selectedRetry = undefined;
      void this.refreshSelected();
    }, this.options.retryMs ?? DEFAULT_RETRY_MS);
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
    if (version !== this.options.selectionVersion?.()) this.retrySelected();
    this.options.onUpdate({
      kind: "snapshot",
      state,
      selectedVersion: relevant ? version : undefined,
    });
    return state;
  }

  private async follow(loop: AbortController, afterSeq: number): Promise<void> {
    const live = (): boolean => !loop.signal.aborted;
    // Each loop turn is one watch. Leaving it means the fold asked for a
    // snapshot, the watch failed, or the store closed it; either way the next
    // turn re-reads.
    let cursor = afterSeq;
    while (live()) {
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
          cursor = next.seq;
          this.options.onUpdate({ kind: "event", state: next, event, selectedVersion: undefined });
          this.scheduleSettle(loop);
          // Config and context are core projections. Retain both after commits,
          // including checkpoints, without clearing the event fold's live text.
          // The read runs behind the fold so its publication never waits on the store.
          if ((event.kind === "run" || event.kind === "commit") && event.head === state.head) {
            this.markMetadataDirty(loop);
          }
        }
        if (!resnapshot) {
          if (!live()) return;
          await this.pause(loop);
          if (!live()) return;
        }
      } catch (cause) {
        if (!live()) return;
        this.options.onError?.(toError(cause));
        await this.pause(loop);
        if (!live()) return;
      }
      try {
        cursor = (await this.snapshot(loop)).seq;
      } catch (cause) {
        if (!live()) return;
        this.options.onError?.(toError(cause));
        await this.pause(loop);
      }
    }
  }

  private markMetadataDirty(loop: AbortController): void {
    this.metadataDirty = true;
    if (this.metadataRefreshing) return;
    this.metadataRefreshing = true;
    void this.refreshMetadata(loop);
  }

  /**
   * Re-read config and context onto the current state while `loop` is the
   * running one. Events marking the head dirty during a read queue exactly
   * one more; a failed read reports and retries after `retryMs`.
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
        const snapshot = await this.nyte.sessions.snapshot({
          sessionId: this.options.sessionId,
          head,
        });
        if (!live()) return;
        // A full snapshot or a newer commit overtook this read; the loop reads again.
        if (generation !== this.snapshots || this.metadataDirty) continue;
        if (snapshot === undefined) throw new Error(`Session not found: ${this.options.sessionId}`);
        const state = this.current;
        if (state === undefined) break;
        const relevant = this.acceptSelected(version, read);
        const next: SessionState = {
          ...state,
          info: {
            ...state.info,
            config: relevant ? snapshot.session.config : state.info.config,
          },
          config: snapshot.config,
          context: snapshot.context,
        };
        this.current = next;
        if (!relevant && version !== this.options.selectionVersion?.()) this.retrySelected();
        this.options.onUpdate({
          kind: "metadata",
          state: next,
          selectedVersion: relevant ? version : undefined,
        });
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
      void this.resync().catch((cause: unknown) => this.options.onError?.(toError(cause)));
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
