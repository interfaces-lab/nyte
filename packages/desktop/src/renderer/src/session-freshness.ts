/**
 * Which copy of a session row to believe when a directory read and a live
 * observation disagree. A directory read opens every session and can outlast
 * a short run, so it may finish carrying state older than a run event that
 * arrived while it was in flight. The newer observation wins, per session.
 */
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";

export class SessionObservations {
  readonly #observedAt = new Map<SessionId, number>();

  observe(sessionId: SessionId, at: number): void {
    this.#observedAt.set(sessionId, at);
  }

  /** The polled row, unless something newer than the poll's start was observed for it. */
  freshest(
    polled: SessionInfo,
    pollStartedAt: number,
    cached: SessionInfo | null | undefined,
  ): SessionInfo {
    const observedAt = this.#observedAt.get(polled.sessionId);
    if (observedAt === undefined || observedAt < pollStartedAt) return polled;
    return cached ?? polled;
  }
}
