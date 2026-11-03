import { ActivationType, compile, SessionChangeType, withJson } from "@nyte-ai/schema";
import type { Activation, HeadName, MessageId, SessionChange, SessionId } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import { openSessionStore } from "@nyte-ai/protocol";
import type { HostSocket, SessionRows, SessionStore, SocketEvent } from "@nyte-ai/protocol";
import { keepRows, listenerSet, request, sameJson } from "./live.ts";
import type { Freshness, Join, Live } from "./live.ts";

type RowIn<T> = T extends ReadonlyMap<string, infer Row> ? Row : never;

export type HeadRows = {
  readonly [K in keyof SessionRows]: ReadonlyMap<string, RowIn<SessionRows[K]>>;
};

export interface HeadSnapshot {
  readonly order: readonly MessageId[];
  readonly leadingPrompt: MessageId | null;
  readonly activation: Activation;
  readonly rows: HeadRows;
}

export interface HeadStore extends Live<HeadSnapshot | null> {
  freshness(): Freshness;
  close(): void;
}

type Held = { readonly store: SessionStore; activation: Activation };

const changes = compile(withJson(SessionChangeType));

const activations = compile(withJson(ActivationType));

export function openHeadStore(
  input: { readonly session: SessionId; readonly head: HeadName; readonly tail: number },
  join: Join,
): HeadStore {
  const listeners = listenerSet();
  let held: Held | null = null;
  let snapshot: HeadSnapshot | null = null;
  let freshness: Freshness = { kind: "stale", since: Date.now() };
  let socket: HostSocket | null = null;
  let stop: (() => void) | null = null;
  let pending: SessionChange[] = [];
  let reading = false;

  const stale = (): void => {
    if (freshness.kind === "stale") return;
    freshness = { kind: "stale", since: Date.now() };
    listeners.notify();
  };

  const settle = (live: HostSocket, current: Held): void => {
    if (current.store.stale) {
      stale();
      void read(live, Promise.resolve());

      return;
    }

    const next = rebuild(current, snapshot);
    const seq = current.store.seq;
    const moved = freshness.kind === "stale" || freshness.seq !== seq;

    if (next === snapshot && !moved) return;
    snapshot = next;

    if (moved) freshness = { kind: "fresh", seq };
    listeners.notify();
  };

  const read = async (live: HostSocket, subscribed: Promise<void>): Promise<void> => {
    reading = true;

    try {
      await subscribed;
      const resume = held?.store;

      const window = await request(live, "head.read", {
        session: input.session,
        head: input.head,
        window: { tail: input.tail },
        resume:
          resume === undefined
            ? undefined
            : { seq: resume.seq, from: resume.snapshot().order[0] ?? null },
      });

      if (socket !== live) return;

      if (held === null)
        held = { store: openSessionStore(window), activation: window.live.activation };
      else {
        held.store.resume(window);
        held.activation = window.live.activation;
      }

      reading = false;

      for (const change of pending.splice(0)) held.store.apply(change);
      settle(live, held);
    } catch (error) {
      dev("sdk", "head read failed", {
        session: input.session,
        head: input.head,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const receive = (live: HostSocket, event: SocketEvent): void => {
    if (event.scope !== `session/${input.session}`) return;

    if (event.kind === "live" && activations.Check(event.activation)) {
      if (held === null) return;
      held.activation = event.activation;

      if (!reading) settle(live, held);

      return;
    }

    if (event.kind !== "change" || !changes.Check(event)) return;

    if (reading || held === null) {
      pending.push(event);

      return;
    }

    held.store.apply(event);
    settle(live, held);
  };

  const leave = join(`session/${input.session}`, {
    attach(live, subscribed) {
      socket = live;
      pending = [];
      stop = live.onEvent((event) => receive(live, event));
      void read(live, subscribed);
    },
    detach() {
      stop?.();
      stop = null;
      socket = null;
      pending = [];
      reading = false;
      stale();
    },
  });

  return {
    subscribe: listeners.subscribe,
    snapshot: () => snapshot,
    freshness: () => freshness,
    close() {
      leave();
      listeners.clear();
    },
  };
}

function rebuild(current: Held, previous: HeadSnapshot | null): HeadSnapshot {
  const source = current.store.snapshot();
  const rows = keepTables(source.rows, previous?.rows);

  const order =
    previous !== null && sameJson(previous.order, source.order) ? previous.order : source.order;

  const activation =
    previous !== null && sameJson(previous.activation, current.activation)
      ? previous.activation
      : current.activation;

  if (
    previous !== null &&
    rows === previous.rows &&
    order === previous.order &&
    activation === previous.activation &&
    source.leadingPrompt === previous.leadingPrompt
  )
    return previous;

  return { order, leadingPrompt: source.leadingPrompt, activation, rows };
}

function keepTables(source: SessionRows, previous: HeadRows | undefined): HeadRows {
  const next: HeadRows = {
    messages: keepRows(source.messages, previous?.messages),
    turns: keepRows(source.turns, previous?.turns),
    parts: keepRows(source.parts, previous?.parts),
    changes: keepRows(source.changes, previous?.changes),
    catalog: keepRows(source.catalog, previous?.catalog),
    heads: keepRows(source.heads, previous?.heads),
    settings: keepRows(source.settings, previous?.settings),
    usage: keepRows(source.usage, previous?.usage),
    background: keepRows(source.background, previous?.background),
  };

  if (previous === undefined) return next;
  const before = Object.values(previous);

  return Object.values(next).every((table, index) => table === before[index]) ? previous : next;
}
