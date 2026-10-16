import type {
  CommitId,
  Disposer,
  PatchEvent,
  Revision,
  SessionEvent,
  SessionId,
} from "@nyte-ai/schema";
import { dev } from "./dev-log.ts";

export interface HeadPair {
  readonly tip: CommitId | null;
  readonly revision: Revision;
}

export interface FeedItem {
  readonly event: SessionEvent | PatchEvent;
  readonly head: HeadPair | null;
}

export interface SessionBus {
  publish(session: SessionId, event: SessionEvent | PatchEvent, head?: HeadPair | null): void;
  subscribe(
    session: SessionId,
    listener: (event: SessionEvent | PatchEvent, head: HeadPair | null) => void,
  ): Disposer;
  subscribeAll(listener: (session: SessionId, event: SessionEvent | PatchEvent) => void): Disposer;
}

export function createBus(): SessionBus {
  const sessions = new Map<
    SessionId,
    Set<(event: SessionEvent | PatchEvent, head: HeadPair | null) => void>
  >();

  const everyone = new Set<(session: SessionId, event: SessionEvent | PatchEvent) => void>();

  return {
    publish(session, event, head = null) {
      const deliver = (call: () => void) => {
        try {
          call();
        } catch (error) {
          dev("bus", "listener failed", { session, event: event.kind, error: String(error) });
        }
      };

      for (const listener of sessions.get(session) ?? []) deliver(() => listener(event, head));

      for (const listener of everyone) deliver(() => listener(session, event));
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
