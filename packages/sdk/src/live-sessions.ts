import {
  ActivationType,
  compile,
  isJsonObject,
  SessionsChangeType,
  withJson,
} from "@nyte-ai/schema";
import type { Activation, Json, SessionId, SessionInfo, SessionsChange } from "@nyte-ai/schema";
import { asSdkError, openDirectoryStore } from "@nyte-ai/protocol";
import type { DirectoryStore, HostSocket, OperationInput, SocketEvent } from "@nyte-ai/protocol";
import { freshnessCell, keepRows, listenerSet, readRetries, request, sameJson } from "./live.ts";
import type { Freshness, Join, Live } from "./live.ts";

export type SessionsWindow = Omit<OperationInput<"sessions.read">, "resume">;

export interface SessionsSnapshot {
  readonly ids: readonly SessionId[];
  readonly rows: ReadonlyMap<string, SessionInfo>;
  readonly activations: ReadonlyMap<string, Activation>;
}

export interface SessionsStore extends Live<SessionsSnapshot | null> {
  freshness(): Freshness;
  close(): void;
}

const changes = compile(withJson(SessionsChangeType));

const activations = compile(withJson(ActivationType));

export function openSessions(window: SessionsWindow, join: Join): SessionsStore {
  const listeners = listenerSet();
  let store: DirectoryStore | null = null;
  let live: ReadonlyMap<string, Activation> = new Map();
  let snapshot: SessionsSnapshot | null = null;
  const freshness = freshnessCell();
  const retries = readRetries();
  let subscribe: () => Promise<void> = async () => undefined;
  let socket: HostSocket | null = null;
  let stop: (() => void) | null = null;
  let pending: SessionsChange[] = [];
  let reading = false;

  const settle = (current: DirectoryStore): void => {
    const next = rebuild(current, live, snapshot);
    const moved = freshness.fresh(current.seq);

    if (next === snapshot && !moved) return;
    snapshot = next;
    listeners.notify();
  };

  const read = async (attached: HostSocket): Promise<void> => {
    reading = true;

    try {
      await subscribe();

      const answer = await request(attached, "sessions.read", {
        ...window,
        resume: store === null ? undefined : { seq: store.seq },
      });

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
    if (event.scope !== "host") return;

    if (event.kind === "live" && event.activations !== undefined) {
      live = readActivations(event.activations);

      if (store !== null && !reading) settle(store);

      return;
    }

    if (event.kind !== "change" || !changes.Check(event)) return;

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

function readActivations(value: Json): ReadonlyMap<string, Activation> {
  if (!isJsonObject(value)) return new Map();

  return new Map(
    Object.entries(value).flatMap((entry) => {
      const activation = entry[1];

      return activations.Check(activation) ? [[entry[0], activation] as const] : [];
    }),
  );
}

function rebuild(
  current: DirectoryStore,
  live: ReadonlyMap<string, Activation>,
  previous: SessionsSnapshot | null,
): SessionsSnapshot {
  const source = current.snapshot();
  const rows = keepRows(source.rows, previous?.rows);
  const held = keepRows(live, previous?.activations);
  const ids = previous !== null && sameJson(previous.ids, source.ids) ? previous.ids : source.ids;

  if (
    previous !== null &&
    rows === previous.rows &&
    held === previous.activations &&
    ids === previous.ids
  )
    return previous;

  return { ids, rows, activations: held };
}
