import { asId, JournalEntrySchema, SdkError } from "@nyte-ai/schema";
import type {
  Awaitable,
  Disposer,
  HeadName,
  HostId,
  JournalEntry,
  Message,
  QueuedMessage,
  ReceiptId,
  SessionId,
  SessionView,
  UserContent,
} from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core/client";
import type { RequestJournal } from "@nyte-ai/core";
import { linkLost } from "@nyte-ai/protocol";
import type { OperationOutput } from "@nyte-ai/protocol";
import type { Rows } from "../connection/rows.ts";
import { untilOpen } from "../live/link.ts";
import { parsed } from "../connection/receipts.ts";
import { listenerSet, retryDelay } from "../live/store.ts";
import type { Live } from "../live/store.ts";

/**
 * Where a send journal keeps its entries: text under a key, one entry per key, so each write and
 * removal is atomic on its own and two processes over one storage never rewrite each other's
 * entries. `read` returns every key it holds; keys it did not get from `write` are read too, and
 * removed when their text is not an entry.
 */
export interface JournalStorage {
  read(): Awaitable<Iterable<readonly [key: string, text: string]>>;
  write(key: string, text: string): Awaitable<void>;
  remove(key: string): Awaitable<void>;
}

export interface JournalLoop {
  send(entry: Omit<JournalEntry, "host">): Promise<Sent>;
  replay(entries: readonly JournalEntry[]): void;
  unsent(session: SessionId, head: HeadName): readonly QueuedMessage[];
  landed(session: SessionId, head: HeadName, view: Landed, seq: number): void;
  expired(session: SessionId, head: HeadName): readonly Message["id"][];
  resend(session: SessionId, message: Message["id"]): Promise<boolean>;
  discard(session: SessionId, message: Message["id"]): Promise<boolean>;
  held(id: ReceiptId): Promise<Sending>;
  subscribe(listener: () => void): Disposer;
  readonly refused: RefusedSends;
}

/** A send the journal replayed, at connect or on `resend`, that the host refused: nothing sends it again, and no `send` is left to hear of it. */
export interface RefusedSend {
  readonly id: ReceiptId;
  readonly session: SessionId;
  readonly head: HeadName;
  readonly content: UserContent;
  readonly error: unknown;
}

/**
 * The replayed sends the host refused, oldest first, the same array until it changes. Each stays
 * listed until `take` takes it, so a client that looks after the host answered still gets its text
 * back.
 */
export interface RefusedSends extends Live<readonly RefusedSend[]> {
  take(id: ReceiptId): void;
}

type Unanswered = "kept" | "removed" | "dropped";

export interface Sending {
  unanswered(): Unanswered | null;
}

const EXPIRES_MS = 24 * 60 * 60 * 1000;

const EXPIRED_REASON = "it waited more than a day";

const EXPIRED = Symbol("expired");

type Sent = OperationOutput<"head.send">;

type Landed = Pick<SessionView, "messages" | "queue" | "leadingPrompt">;

interface Held {
  entry: JournalEntry;
  attempts: number;
  retrying: { readonly at: number; readonly reason: string } | null;
  answered: Message["id"] | null;
  answeredAfter: number | null;
  expired: boolean;
  discarded: AbortController;
  unanswered: Unanswered | null;
}

/**
 * Returns a journal over `storage`, in memory by default. Each entry is stored under its host and
 * receipt id, so clients of several hosts can share one storage, and `load` returns every host's
 * entries, oldest first, for `connect` to replay the answering host's.
 */
export function createSendJournal(storage: JournalStorage = memoryStorage()): RequestJournal {
  const keys = new Map<ReceiptId, string>();

  return {
    async load() {
      const stored = [...(await storage.read())].map(([key, text]) => ({
        key,
        entry: readEntry(text),
      }));

      await Promise.all(
        stored.map(async ({ key, entry }) => {
          if (entry === null) await storage.remove(key);
        }),
      );

      return stored
        .flatMap(({ key, entry }) => {
          if (entry === null) return [];
          keys.set(entry.id, key);

          return [entry];
        })
        .toSorted((left, right) => left.at - right.at);
    },
    async put(entry) {
      const key = keys.get(entry.id) ?? JSON.stringify([entry.host, entry.id]);
      keys.set(entry.id, key);
      await storage.write(key, JSON.stringify(entry));
    },
    async remove(id) {
      const key = keys.get(id);

      if (key === undefined) return;
      keys.delete(id);
      await storage.remove(key);
    },
  };
}

function memoryStorage(): JournalStorage {
  const texts = new Map<string, string>();

  return {
    read: () => texts.entries(),
    write(key, text) {
      texts.set(key, text);
    },
    remove(key) {
      texts.delete(key);
    },
  };
}

function readEntry(text: string): JournalEntry | null {
  try {
    return parsed(JournalEntrySchema, JSON.parse(text));
  } catch {
    return null;
  }
}

export function journalLoop(rows: Rows, journal: RequestJournal, host: HostId): JournalLoop {
  const held = new Map<string, Held>();
  const waiting = new Map<string, PromiseWithResolvers<Sending>>();
  const writes = new Map<string, Promise<void>>();
  const tails = new Map<string, Promise<void>>();
  const shown = new Map<string, number>();
  const listeners = listenerSet();
  const refusals = listenerSet();
  let refused: readonly RefusedSend[] = [];
  const changed = listeners.notify;

  const attempt = async (entry: JournalEntry): Promise<Sent | typeof EXPIRED> => {
    const { id, session, head, content, options } = entry;

    if (Date.now() - entry.at >= EXPIRES_MS) {
      const seen = await rows.call("receipt.status", { session, receipt: id });

      if (seen.kind === "missing") return EXPIRED;
    }

    return rows.call("head.send", { session, head, content, options: { ...options, id } });
  };

  const post = async (current: Held): Promise<Sent> => {
    const { id, session } = current.entry;
    const discarded = current.discarded.signal;

    for (;;) {
      discarded.throwIfAborted();

      try {
        const sent = await attempt(current.entry);

        if (sent === EXPIRED) break;

        if (!discarded.aborted) return sent;
        await rows.call("receipt.stop", { session, receipt: id });
      } catch (error) {
        const closing = rows.link.closed.aborted || rows.link.snapshot().kind === "refused";

        if (closing || !linkLost(error)) {
          if (!closing) await journal.remove(id);
          current.unanswered ??= closing ? "kept" : "dropped";
          held.delete(id);
          changed();

          throw error;
        }

        current.attempts += 1;
        const delay = retryDelay(current.attempts - 1);
        dev("sdk", "send retrying", { receipt: id, attempts: current.attempts, delay });
        current.retrying = { at: Date.now() + delay, reason: error.message };
        changed();
        await untilOpen(rows.link, delay, AbortSignal.any([rows.link.closed, discarded]));
      }
    }

    current.expired = true;
    current.unanswered = "kept";
    current.retrying = { at: current.entry.at + EXPIRES_MS, reason: EXPIRED_REASON };
    dev("sdk", "send expired", { receipt: id, attempts: current.attempts });
    changed();

    throw new SdkError(
      "timeout",
      "The message wasn't sent: it waited more than a day. Send it again or remove it.",
    );
  };

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

    for (const row of later) {
      row.entry = { ...row.entry, options: { ...row.entry.options, replace: message } };
    }

    await Promise.all(later.map((row) => journal.put(row.entry)));
  };

  const hold = (entry: JournalEntry): Promise<Sent> => {
    const current: Held = {
      entry,
      attempts: 0,
      retrying: null,
      answered: null,
      answeredAfter: null,
      expired: false,
      discarded: new AbortController(),
      unanswered: null,
    };

    const key = JSON.stringify([entry.session, entry.head]);

    const sent = (tails.get(key) ?? Promise.resolve()).then(async () => {
      const answer = await post(current);
      current.answered = answer.message;
      current.answeredAfter = shown.get(key) ?? null;
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
    waiting.get(entry.id)?.resolve({ unanswered: () => current.unanswered });
    waiting.delete(entry.id);
    changed();

    return sent;
  };

  const holdReplayed = (entry: JournalEntry): void => {
    const sent = hold(entry);
    const current = held.get(entry.id);

    sent.catch((error: unknown) => {
      dev("sdk", "replay failed", {
        receipt: entry.id,
        code: error instanceof SdkError ? error.code : "internal",
      });

      if (current?.unanswered !== "dropped") return;
      refused = refused.concat({
        id: entry.id,
        session: entry.session,
        head: entry.head,
        content: entry.content,
        error,
      });
      refusals.notify();
    });
  };

  const replay = (entries: readonly JournalEntry[]): void => {
    for (const entry of entries.filter((entry) => entry.host === host)) holdReplayed(entry);
  };

  const shownHeld = (session: SessionId, head: HeadName): ReadonlyMap<Message["id"], Held> => {
    const shown = new Map<Message["id"], Held>();
    const slots = new Map<Message["id"], Message["id"]>();

    for (const current of held.values()) {
      if (current.entry.session !== session || current.entry.head !== head) continue;
      const target = current.entry.options.replace ?? asId<"message">(current.entry.id);
      const slot = slots.get(target) ?? target;
      shown.set(slot, current);

      if (current.answered !== null && current.answered !== target) {
        slots.set(current.answered, slot);
      }
    }

    return shown;
  };

  const expiredHeld = (session: SessionId, message: Message["id"]): readonly Held[] =>
    [...held.values()].filter(
      (current) =>
        current.expired &&
        current.entry.session === session &&
        (current.entry.options.replace ?? asId<"message">(current.entry.id)) === message,
    );

  return {
    async send(unhosted) {
      const entry = { ...unhosted, host };
      const key = JSON.stringify([entry.session, entry.head]);

      const written = (writes.get(key) ?? Promise.resolve()).then(async () => {
        await journal.put(entry);

        return { sent: hold(entry) };
      });

      const tail = written.then(
        () => undefined,
        () => {
          waiting.delete(entry.id);
        },
      );

      writes.set(key, tail);
      void tail.then(() => {
        if (writes.get(key) === tail) writes.delete(key);
      });

      return (await written).sent;
    },
    replay,
    unsent: (session, head) =>
      [...shownHeld(session, head)].map(([id, current]) => unsentMessage(id, current)),
    expired: (session, head) =>
      [...shownHeld(session, head)].flatMap(([id, current]) => (current.expired ? [id] : [])),
    landed(session, head, view, seq) {
      const key = JSON.stringify([session, head]);
      shown.set(key, Math.max(shown.get(key) ?? 0, seq));

      if (held.size === 0) return;
      const ids = new Set([...view.messages, ...view.queue].map((message) => message.id));

      if (view.leadingPrompt !== null) ids.add(view.leadingPrompt.id);

      for (const [receipt, current] of held) {
        const { answered, answeredAfter, entry } = current;

        if (
          answered === null ||
          entry.session !== session ||
          entry.head !== head ||
          (!ids.has(answered) && answeredAfter !== null && seq <= answeredAfter)
        ) {
          continue;
        }
        held.delete(receipt);
        journal
          .remove(current.entry.id)
          .catch(() => dev("sdk", "journal remove failed", { receipt }));
        dev("sdk", "send landed", { receipt });
      }
    },
    async resend(session, message) {
      const again = expiredHeld(session, message).map((current) => ({
        ...current.entry,
        at: Date.now(),
      }));

      for (const entry of again) held.delete(entry.id);
      await Promise.all(again.map((entry) => journal.put(entry)));
      dev("sdk", "send again", { receipts: again.map((entry) => entry.id) });
      replay(again);

      return again.length > 0;
    },
    async discard(session, message) {
      const gone = [...held.values()].filter(
        (current) =>
          current.answered === null &&
          current.entry.session === session &&
          (current.entry.options.replace ?? asId<"message">(current.entry.id)) === message,
      );

      for (const current of gone) {
        held.delete(current.entry.id);
        current.unanswered = "removed";
        current.discarded.abort(
          new SdkError("unknown", "The message was removed before the host had it."),
        );
      }

      await Promise.all(gone.map((current) => journal.remove(current.entry.id)));

      if (gone.length > 0) changed();

      return gone.length > 0;
    },
    held(id) {
      const current = held.get(id);

      if (current !== undefined) return Promise.resolve({ unanswered: () => current.unanswered });
      const known = waiting.get(id) ?? Promise.withResolvers<Sending>();
      waiting.set(id, known);

      return known.promise;
    },
    subscribe: listeners.subscribe,
    refused: {
      subscribe: refusals.subscribe,
      snapshot: () => refused,
      take(id) {
        if (!refused.some((send) => send.id === id)) return;
        refused = refused.filter((send) => send.id !== id);
        refusals.notify();
      },
    },
  };
}

function unsentMessage(id: Message["id"], { entry, attempts, retrying }: Held): QueuedMessage {
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
