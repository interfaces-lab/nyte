import type {
  CommitId,
  Disposer,
  PatchEvent,
  Revision,
  SessionEvent,
  SessionId,
} from "@nyte-ai/schema";
import { dev } from "./dev-log.ts";

/** A head ref as one write left it: the commit it targets (null when deleted) and its revision (empty when deleted). */
export interface HeadPair {
  readonly tip: CommitId | null;
  readonly revision: Revision;
}

/** One event as a feed carries it, with the head ref its write left when it moved a head (§54a). */
export interface FeedItem {
  readonly event: SessionEvent | PatchEvent;
  readonly head: HeadPair | null;
}

/** Carries every session's live events, durable and transient, to in-process listeners. */
export interface SessionBus {
  publish(session: SessionId, event: SessionEvent | PatchEvent, head?: HeadPair | null): void;
  subscribe(
    session: SessionId,
    listener: (event: SessionEvent | PatchEvent, head: HeadPair | null) => void,
  ): Disposer;
  subscribeAll(listener: (session: SessionId, event: SessionEvent | PatchEvent) => void): Disposer;
}

/** Returns an in-process bus with no listeners. */
export function createBus(): SessionBus {
  const sessions = new Map<
    SessionId,
    Set<(event: SessionEvent | PatchEvent, head: HeadPair | null) => void>
  >();

  const everyone = new Set<(session: SessionId, event: SessionEvent | PatchEvent) => void>();

  return {
    publish(session, event, head = null) {
      dev("bus", event.kind, { session, seq: "seq" in event ? event.seq : null });

      for (const listener of sessions.get(session) ?? []) listener(event, head);

      for (const listener of everyone) listener(session, event);
    },
    subscribe(session, listener) {
      const listeners = sessions.get(session) ?? new Set();
      listeners.add(listener);
      sessions.set(session, listeners);

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0 && sessions.get(session) === listeners) sessions.delete(session);
      };
    },
    subscribeAll(listener) {
      everyone.add(listener);

      return () => {
        everyone.delete(listener);
      };
    },
  };
}
