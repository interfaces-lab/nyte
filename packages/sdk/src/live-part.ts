import { isJson } from "@nyte-ai/schema";
import type { PartId, PartView, SessionChange, SessionId } from "@nyte-ai/schema";
import { asSdkError } from "@nyte-ai/protocol";
import type { HostSocket, SocketEvent } from "@nyte-ai/protocol";
import { sessionChanges } from "./event-checks.ts";
import { freshnessCell, listenerSet, readRetries, request } from "./live.ts";
import type { Freshness, Join, Live } from "./live.ts";

export type PartSnapshot = { readonly part: PartView | null };

export interface PartStore extends Live<PartSnapshot | null> {
  freshness(): Freshness;
  close(): void;
}

type Held = { readonly seq: number; readonly row: PartView | null };

export function openPartStore(
  input: { readonly session: SessionId; readonly part: PartId },
  join: Join,
): PartStore {
  const listeners = listenerSet();
  const freshness = freshnessCell();
  const retries = readRetries();
  let held: Held | null = null;
  let snapshot: PartSnapshot | null = null;
  let socket: HostSocket | null = null;
  let subscribe: () => Promise<void> = async () => undefined;
  let stop: (() => void) | null = null;
  let pending: SessionChange[] = [];
  let reading = false;

  const settle = (current: Held): void => {
    const recovered = freshness.current().kind === "stale";
    freshness.fresh(current.seq);

    if (snapshot?.part === current.row && !recovered) return;

    if (snapshot?.part !== current.row) snapshot = { part: current.row };
    listeners.notify();
  };

  const read = async (live: HostSocket): Promise<void> => {
    reading = true;

    try {
      const subscribing = subscribe();
      const result = await request(live, "part.read", { session: input.session, part: input.part });

      await subscribing;

      if (socket !== live) return;
      reading = false;
      retries.reset();
      const next = applyAll({ seq: result.seq, row: result.part }, pending.splice(0), input.part);

      if (next === null) {
        void read(live);

        return;
      }

      held = next;
      settle(held);
    } catch (error) {
      if (socket !== live) return;

      if (freshness.stale(asSdkError(error))) listeners.notify();
      retries.failed(() => {
        if (socket === live) void read(live);
      });
    }
  };

  const receive = (live: HostSocket, event: SocketEvent): void => {
    if (event.scope !== `session/${input.session}`) return;

    if (event.kind !== "change" || !sessionChanges.Check(event)) return;

    if (reading || held === null) {
      pending.push(event);

      return;
    }

    const next = applyAll(held, [event], input.part);

    if (next === null) {
      void read(live);

      return;
    }

    held = next;
    settle(held);
  };

  const leave = join(`session/${input.session}`, {
    attach(live, subscribing) {
      socket = live;
      subscribe = subscribing;
      pending = [];
      stop = live.onEvent((event) => receive(live, event));
      void read(live);
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

function applyAll(held: Held, events: readonly SessionChange[], part: PartId): Held | null {
  return events.reduce<Held | null>(
    (current, change) =>
      current === null || change.seq <= current.seq ? current : applyChange(current, change, part),
    held,
  );
}

function applyChange(held: Held, change: SessionChange, part: PartId): Held | null {
  const seq = change.seq;
  const view = change.tables.parts?.upsert.find((row) => row.id === part);

  if (view !== undefined) return { seq, row: view };

  if (change.tables.parts?.drop.includes(part) === true) return null;
  const message = change.tables.messages?.upsert.find(
    (candidate) => candidate.kind === "part" && candidate.part === part,
  );
  const row = held.row;

  if (message?.kind !== "part") return { seq, row };
  const state = message.state;

  if (row?.placement.kind !== "transcript" || !isJson(state)) return null;

  return { seq, row: { ...row, state, version: message.version, status: message.status } };
}
