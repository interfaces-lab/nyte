import type { SessionId, SessionInfo, SessionsChange } from "@nyte-ai/schema";
import { asSdkError, openDirectoryStore } from "@nyte-ai/protocol";
import type { DirectoryStore, HostSocket, OperationInput, SocketEvent } from "@nyte-ai/protocol";
import { sessionsChanges } from "../event-checks.ts";
import { freshnessCell, keepRows, listenerSet, readRetries, request, sameJson } from "./store.ts";
import type { Freshness, Join, Live } from "./store.ts";

export type SessionsWindow = Omit<OperationInput<"sessions.read">, "resume">;

export interface SessionsSnapshot {
  readonly ids: readonly SessionId[];
  readonly rows: ReadonlyMap<string, SessionInfo>;
}

export interface SessionsStore extends Live<SessionsSnapshot | null> {
  freshness(): Freshness;
  close(): void;
}

export function openSessions(window: SessionsWindow, join: Join): SessionsStore {
  const listeners = listenerSet();
  let store: DirectoryStore | null = null;
  let snapshot: SessionsSnapshot | null = null;
  const freshness = freshnessCell();
  const retries = readRetries();
  let subscribe: () => Promise<void> = async () => undefined;
  let socket: HostSocket | null = null;
  let stop: (() => void) | null = null;
  let pending: SessionsChange[] = [];
  let reading = false;

  const settle = (current: DirectoryStore): void => {
    const next = rebuild(current, snapshot);
    const moved = freshness.fresh(current.seq);

    if (next === snapshot && !moved) return;
    snapshot = next;
    listeners.notify();
  };

  const read = async (attached: HostSocket): Promise<void> => {
    reading = true;

    try {
      const subscribing = subscribe();
      const resume = store?.describe();

      const answer = await request(attached, "sessions.read", { ...window, resume });

      await subscribing;

      if (socket !== attached) return;

      if (store === null) store = openDirectoryStore(answer, window);
      else store.resume(answer);

      reading = false;
      retries.reset();

      for (const change of pending.splice(0)) store.apply(change);
      settle(store);
    } catch (error) {
      if (socket !== attached) return;

      if (freshness.stale(asSdkError(error))) listeners.notify();
      retries.failed(() => {
        if (socket === attached) void read(attached);
      });
    }
  };

  const receive = (event: SocketEvent): void => {
    if (event.scope !== "host" || event.kind !== "change" || !sessionsChanges.Check(event)) return;

    if (reading || store === null) {
      pending.push(event);

      return;
    }

    store.apply(event);
    settle(store);
  };

  const leave = join("host", {
    attach(attached, subscribing) {
      socket = attached;
      subscribe = subscribing;
      pending = [];
      stop = attached.onEvent(receive);
      void read(attached);
    },
    detach() {
      stop?.();
      stop = null;
      socket = null;
      pending = [];
      reading = false;
      retries.reset();

      if (freshness.stale(null)) listeners.notify();
    },
  });

  return {
    subscribe: listeners.subscribe,
    snapshot: () => snapshot,
    freshness: freshness.current,
    close() {
      leave();
      retries.reset();
      listeners.clear();
    },
  };
}

function rebuild(current: DirectoryStore, previous: SessionsSnapshot | null): SessionsSnapshot {
  const source = current.snapshot();
  const rows = keepRows(source.rows, previous?.rows);
  const ids = previous !== null && sameJson(previous.ids, source.ids) ? previous.ids : source.ids;

  if (previous !== null && rows === previous.rows && ids === previous.ids) return previous;

  return { ids, rows };
}
