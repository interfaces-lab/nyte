import { asId } from "@nyte-ai/schema";
import type { Disposer, HeadName, JournalEntry, Message, SessionId } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import type { RequestJournal } from "@nyte-ai/core";
import type { OperationOutput } from "@nyte-ai/protocol";
import type { Rows } from "./rows.ts";
import { backoff, delayOf, isLinkLoss } from "./rows.ts";

/**
 * Holds the sends this connection has journaled and the host has not yet
 * shown: what a head's view merges as `unsent` user messages.
 *
 * `send` journals an entry before the wire, sends it with its id until the
 * host acknowledges it, retrying across link loss, and removes it from the
 * journal on acknowledgement. `rewrite` replaces a send not yet acknowledged
 * (its journal row and what the next attempt sends, §47g), or answers null;
 * once the host has the id, a rewrite is retried only as a `replace` of it,
 * never as the id with new content (§47m).
 * An acknowledged send stays shown until a fold reports it with `landed`
 * (at most 256 kept, §47h).
 */
export interface Outbox {
  send(entry: JournalEntry): Promise<Sent>;
  rewrite(
    id: string,
    content: JournalEntry["content"],
    options: JournalEntry["options"],
  ): Promise<Sent> | null;
  unsent(session: SessionId, head: HeadName): readonly Message[];
  landed(id: string): void;
  subscribe(listener: () => void): Disposer;
}

type Sent = OperationOutput<"head.send">;

type Held = {
  entry: JournalEntry;
  version: number;
  attempts: number;
  retrying: { readonly at: number; readonly reason: string } | null;
  message: Message;
  sent: Promise<Sent> | null;
};

const KEPT_ACKNOWLEDGED = 256;

/** Returns an empty outbox writing to `journal`. */
export function createOutbox(rows: Rows, journal: RequestJournal): Outbox {
  const held = new Map<string, Held>();
  const acknowledged = new Set<string>();
  const listeners = new Set<() => void>();

  const changed = (current?: Held): void => {
    if (current !== undefined)
      current.message = unsentMessage(current.entry, current.attempts, current.retrying);

    for (const listener of listeners) listener();
  };

  const drop = (id: string): void => {
    acknowledged.delete(id);

    if (held.delete(id)) changed();
  };

  const post = (entry: JournalEntry, options: JournalEntry["options"]): Promise<Sent> =>
    rows.call("head.send", {
      session: entry.session,
      head: entry.head,
      content: entry.content,
      options,
    });

  const retry = async <T>(current: Held, attempt: () => Promise<T>): Promise<T> => {
    for (;;) {
      try {
        return await attempt();
      } catch (error) {
        if (rows.link.signal.aborted || !isLinkLoss(error)) {
          if (!rows.link.signal.aborted) await journal.remove(current.entry.id);
          drop(current.entry.id);

          throw error;
        }

        current.attempts += 1;
        const delay = delayOf(current.attempts);
        dev("sdk", "send retrying", {
          receipt: current.entry.id,
          attempts: current.attempts,
          delay,
        });
        current.retrying = { at: Date.now() + delay, reason: error.message };
        changed(current);
        await backoff(rows.link, delay, rows.link.signal);
      }
    }
  };

  const deliver = async (current: Held): Promise<Sent> => {
    const { id } = current.entry;
    let posted = current.version;

    const sent = await retry(current, () => {
      posted = current.version;

      return post(current.entry, { ...current.entry.options, id });
    });

    while (posted !== current.version)
      await retry(current, () => {
        posted = current.version;

        return post(current.entry, { ...current.entry.options, replace: sent.message });
      });

    await journal.remove(id);
    acknowledged.add(id);

    for (const old of [...acknowledged].slice(0, -KEPT_ACKNOWLEDGED)) drop(old);
    dev("sdk", "send acknowledged", { receipt: id, attempts: current.attempts + 1 });

    return sent;
  };

  return {
    async send(entry) {
      await journal.put(entry);

      const current: Held = {
        entry,
        version: 0,
        attempts: 0,
        retrying: null,
        message: unsentMessage(entry, 0, null),
        sent: null,
      };

      held.set(entry.id, current);
      changed();
      const sent = deliver(current);
      current.sent = sent;

      return sent;
    },
    rewrite(id, content, options) {
      const current = held.get(id);
      const sent = current?.sent ?? null;

      if (current === undefined || sent === null || acknowledged.has(id)) return null;
      current.entry = { ...current.entry, content, options };
      current.version += 1;
      changed(current);
      dev("sdk", "send rewritten", { receipt: id, version: current.version });

      return journal.put(current.entry).then(() => sent);
    },
    unsent: (session, head) =>
      [...held.values()].flatMap(({ entry, message }) =>
        entry.session === session && entry.head === head ? [message] : [],
      ),
    landed(id) {
      if (acknowledged.has(id)) drop(id);
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Returns a journaled send as the user message a view shows before the host has it: status `unsent`, its pending turn, no siblings. */
function unsentMessage(
  entry: JournalEntry,
  attempts: number,
  retrying: { readonly at: number; readonly reason: string } | null,
): Message {
  const id = asId<"message">(entry.id);

  return {
    id,
    turn: asId<"turn">(`pending:${id}`),
    at: entry.at,
    kind: "user",
    content: entry.content,
    source: entry.options.source ?? { kind: "user" },
    delivery: entry.options.delivery ?? "steer",
    status: { kind: "unsent", attempts, retrying },
    siblings: { index: 0, count: 1, ids: [] },
  };
}
