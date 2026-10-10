import { asId, asSeq } from "@nyte-ai/schema";
import type {
  Disposer,
  PatchEvent,
  RefUpdate,
  Seq,
  SessionEvent,
  SessionId,
  SetOutcome,
} from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";

/** Carries every session's live events, durable and transient, to in-process listeners. */
export interface SessionBus {
  /** Delivers one event to the session's listeners and to every `subscribeAll` listener. */
  publish(session: SessionId, event: SessionEvent | PatchEvent): void;
  /** Calls the listener for each event published to the session; the disposer stops it. */
  subscribe(session: SessionId, listener: (event: SessionEvent | PatchEvent) => void): Disposer;
  /** Calls the listener for each event published to any session; the disposer stops it. */
  subscribeAll(listener: (session: SessionId, event: SessionEvent | PatchEvent) => void): Disposer;
}

/** Returns an in-process bus with no listeners. */
export function createBus(): SessionBus {
  const sessions = new Map<SessionId, Set<(event: SessionEvent | PatchEvent) => void>>();
  const everyone = new Set<(session: SessionId, event: SessionEvent | PatchEvent) => void>();

  return {
    publish(session, event) {
      for (const listener of sessions.get(session) ?? []) listener(event);

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

const LOG_PAGE = 256;

const published = new WeakMap<Kernel, Map<SessionId, Seq>>();

/** Records a successful set's ref revisions, then publishes its events to their sessions with the seq and time the store logged. */
export async function publishSet(
  kernel: Kernel,
  updates: readonly RefUpdate[],
  outcome: SetOutcome,
): Promise<void> {
  if (outcome.kind !== "set") return;

  for (const [index, update] of updates.entries()) {
    const revision = outcome.revisions[index];

    if (update.target === null || revision === undefined) kernel.revisions.delete(update.name);
    else kernel.revisions.set(update.name, revision);
  }

  const counts = new Map<SessionId, number>();
  let last: SessionId | null = null;

  for (const update of updates) {
    const session = update.event === undefined ? null : sessionOf(update.name);

    if (session === null) continue;
    counts.set(session, (counts.get(session) ?? 0) + 1);
    last = session;
  }

  const marks = published.get(kernel) ?? new Map<SessionId, Seq>();
  published.set(kernel, marks);

  for (const [session, count] of counts) {
    if (!marks.has(session)) {
      const through = session === last ? outcome.seq : await kernel.store.refs.tail(session);
      marks.set(session, asSeq(Math.max(0, through - count)));
    }

    await drain(kernel, marks, session);
  }
}

async function drain(
  kernel: Kernel,
  marks: Map<SessionId, Seq>,
  session: SessionId,
): Promise<void> {
  for (;;) {
    const events = await kernel.store.refs.log(session, marks.get(session) ?? asSeq(0), LOG_PAGE);

    for (const event of events) {
      if (event.seq <= (marks.get(session) ?? 0)) continue;
      marks.set(session, event.seq);
      kernel.bus.publish(session, event);
    }

    if (events.length < LOG_PAGE) return;
  }
}

function sessionOf(name: string): SessionId | null {
  const [root, id] = name.split("/");

  return root === "sessions" && id ? asId<"session">(id) : null;
}
