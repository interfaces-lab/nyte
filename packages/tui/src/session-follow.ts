/**
 * Keeps a `SessionState` current for one head: one snapshot, then `watch`
 * from the snapshot's seq, refolded with `foldEvent`. The fold asks for a
 * new snapshot when it cannot apply an event; so does a watch that fails,
 * including a cursor older than the event floor (design record, "Events and
 * views"). A head that moved without the commits to follow settles the same
 * way once the events of that batch have all arrived.
 */
import type { HeadName, Nyte, SessionEvent, SessionId } from "@nyte-ai/core";
import { foldEvent, stateFromSnapshot, tipMismatch, type SessionState } from "./session-state.ts";

export interface SessionUpdate {
  readonly state: SessionState;
  /** The event that produced this state; absent after a snapshot. */
  readonly event?: SessionEvent;
}

export interface SessionFollowerOptions {
  readonly sessionId: SessionId;
  readonly head?: HeadName;
  readonly onUpdate: (update: SessionUpdate) => void;
  /** A watch failed or the session disappeared; the follower retries after `retryMs`. */
  readonly onError?: (error: Error) => void;
  readonly retryMs?: number;
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
  private settleTimer: ReturnType<typeof setTimeout> | undefined;

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
    this.loop?.abort();
    this.loop = undefined;
    if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
  }

  private async restart(): Promise<SessionState> {
    if (this.closed) throw new Error("The session follower is closed");
    this.loop?.abort();
    const loop = new AbortController();
    this.loop = loop;
    const state = await this.snapshot(loop);
    void this.follow(loop, state.seq);
    return state;
  }

  private async snapshot(loop: AbortController): Promise<SessionState> {
    const head = this.options.head;
    const snapshot = await this.nyte.sessions.snapshot(
      head === undefined
        ? { sessionId: this.options.sessionId }
        : { sessionId: this.options.sessionId, head },
    );
    if (snapshot === undefined) throw new Error(`Session not found: ${this.options.sessionId}`);
    const state = stateFromSnapshot(snapshot);
    if (loop.signal.aborted) return state;
    this.current = state;
    this.options.onUpdate({ state });
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
          this.current = outcome.state;
          cursor = outcome.state.seq;
          this.options.onUpdate({ state: outcome.state, event });
          this.scheduleSettle(loop);
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

  /**
   * A moved head is followed by the commits that moved it, in one batch of
   * events the projection yields together. Check for a tip that never
   * arrived on a later tick, after the batch has been consumed.
   */
  private scheduleSettle(loop: AbortController): void {
    if (this.settleTimer !== undefined) return;
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
