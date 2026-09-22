import { SessionObserver, type SessionObserverClient } from "@nyte-ai/client";
import type { SessionId } from "@nyte-ai/protocol";

const clients = new WeakMap<
  SessionObserverClient,
  Map<SessionId, ReturnType<typeof observation>>
>();

function observation(client: SessionObserverClient, sessionId: SessionId) {
  const consumers = new Set<{ onError: (cause: Error) => void }>();
  const selection = { version: 0 };

  const observer = new SessionObserver(client, {
    sessionId,
    retryMs: 1_000,
    selectionVersion: () => selection.version,
    onError(cause) {
      for (const consumer of consumers) consumer.onError(cause);
    },
  });

  return { observer, selection, consumers };
}

export function observeSession(
  client: SessionObserverClient,
  sessionId: SessionId,
  onError: (cause: Error) => void,
) {
  let sessions = clients.get(client);

  if (sessions === undefined) {
    sessions = new Map();
    clients.set(client, sessions);
  }

  const existing = sessions.get(sessionId);
  const shared = existing ?? observation(client, sessionId);
  const consumer = { onError };
  shared.consumers.add(consumer);

  if (existing === undefined) {
    sessions.set(sessionId, shared);
    void shared.observer.start().catch(() => undefined);
  }

  return {
    observer: shared.observer,
    selection: shared.selection,
    close() {
      if (!shared.consumers.delete(consumer) || shared.consumers.size > 0) return;

      shared.observer.close();
      sessions.delete(sessionId);
    },
  };
}
