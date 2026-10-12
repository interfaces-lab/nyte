import { asId } from "@nyte-ai/schema";
import type { Disposer, HeadName, JournalEntry, Message, SessionId } from "@nyte-ai/schema";
import { SdkError, dev } from "@nyte-ai/core";
import type { RequestJournal } from "@nyte-ai/core";
import type { OperationOutput } from "@nyte-ai/protocol";
import type { Rows } from "./rows.ts";
import { backoff, delayOf, isLinkLoss } from "./rows.ts";

/**
 * Drives this connection's journal: each send is a row posted under its own id with the content it was
 * journaled with, after the rows before it on its head, and shown `unsent` until a fold contains the
 * message its answer named (§49c). A `replace` is its own row behind its target (ADV C 2), so an id
 * never leaves with two contents; `replay` holds every row before the first is delivered (ADV C 4).
 */
export interface JournalLoop {
  send(entry: JournalEntry): Promise<Sent>;
  replay(entries: readonly JournalEntry[]): void;
  unsent(session: SessionId, head: HeadName): readonly Message[];
  landed(contains: (message: Message["id"]) => boolean): void;
  subscribe(listener: () => void): Disposer;
}

type Sent = OperationOutput<"head.send">;

type Held = {
  entry: JournalEntry;
  attempts: number;
  retrying: { readonly at: number; readonly reason: string } | null;
  answered: Message["id"] | null;
};

/** Returns the default request journal: entries in memory, in the order they were first written, gone with the process. Enough for a cli or a script; a client that must survive its own restart passes a persistent one. */
export function memoryJournal(): RequestJournal {
  const entries = new Map<string, JournalEntry>();

  return {
    load: async () => [...entries.values()],
    async put(entry) {
      entries.set(entry.id, entry);
    },
    async remove(id) {
      entries.delete(id);
    },
  };
}

/** Returns an empty retry loop over `journal`. A send failing for a reason other than link loss is removed from the journal (§47j); one cut by `close()` stays for the next connect. */
export function journalLoop(rows: Rows, journal: RequestJournal): JournalLoop {
  const held = new Map<string, Held>();
  const tails = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();

  const changed = (): void => {
    for (const listener of listeners) listener();
  };

  const post = async (current: Held): Promise<Sent> => {
    const { id, session, head, content, options } = current.entry;

    for (;;) {
      try {
        return await rows.call("head.send", {
          session,
          head,
          content,
          options: { ...options, id },
        });
      } catch (error) {
        if (rows.link.signal.aborted || !isLinkLoss(error)) {
          if (!rows.link.signal.aborted) await journal.remove(id);
          held.delete(id);
          changed();

          throw error;
        }

        current.attempts += 1;
        const delay = delayOf(current.attempts);
        dev("sdk", "send retrying", { receipt: id, attempts: current.attempts, delay });
        current.retrying = { at: Date.now() + delay, reason: error.message };
        changed();
        await backoff(rows.link, delay, rows.link.signal);
      }
    }
  };

  /** Points the later rows replacing what `current` replaced at the message its answer named (an edit's fresh id); none of them has left yet. */
  const retarget = async (current: Held, message: Message["id"]): Promise<void> => {
    const target = current.entry.options.replace ?? current.entry.id;

    if (message === target) return;
    const all = [...held.values()];

    const later = all
      .slice(all.indexOf(current) + 1)
      .filter(
        ({ entry }) =>
          entry.session === current.entry.session &&
          entry.head === current.entry.head &&
          entry.options.replace === target,
      );

    for (const row of later)
      row.entry = { ...row.entry, options: { ...row.entry.options, replace: message } };

    await Promise.all(later.map((row) => journal.put(row.entry)));
  };

  const hold = (entry: JournalEntry): Promise<Sent> => {
    const current: Held = { entry, attempts: 0, retrying: null, answered: null };
    const key = JSON.stringify([entry.session, entry.head]);

    const sent = (tails.get(key) ?? Promise.resolve()).then(async () => {
      const answer = await post(current);
      current.answered = answer.message;
      await retarget(current, answer.message);
      dev("sdk", "send answered", { receipt: entry.id, attempts: current.attempts + 1 });
      changed();

      return answer;
    });

    const tail = sent.then(
      () => undefined,
      () => undefined,
    );

    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    held.set(entry.id, current);
    changed();

    return sent;
  };

  return {
    async send(entry) {
      await journal.put(entry);

      return hold(entry);
    },
    replay(entries) {
      for (const entry of entries)
        hold(entry).catch((error: unknown) =>
          dev("sdk", "replay failed", {
            receipt: entry.id,
            code: error instanceof SdkError ? error.code : "internal",
          }),
        );
    },
    unsent(session, head) {
      const shown = new Map<Message["id"], Held>();

      for (const current of held.values())
        if (current.entry.session === session && current.entry.head === head)
          shown.set(
            current.answered ?? current.entry.options.replace ?? asId<"message">(current.entry.id),
            current,
          );

      return [...shown].map(([id, current]) => unsentMessage(id, current));
    },
    landed(contains) {
      for (const [receipt, current] of held) {
        if (current.answered === null || !contains(current.answered)) continue;
        held.delete(receipt);
        journal
          .remove(current.entry.id)
          .catch(() => dev("sdk", "journal remove failed", { receipt }));
        dev("sdk", "send landed", { receipt });
      }
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Returns a journaled send as the user message a view shows under `id` before the host has it: status `unsent`, its pending turn, no siblings. */
function unsentMessage(id: Message["id"], { entry, attempts, retrying }: Held): Message {
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
