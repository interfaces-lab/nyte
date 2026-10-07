/**
 * Root starts this browser has sent, or is about to send, to a registry host.
 * A start is recorded before the first attempt with everything it targets:
 * the request id, the folder, the model and the message. Recording an id that
 * is already on record keeps the first input, so a retry or a reload asks the
 * host again about exactly what was first sent and gets the same chat back.
 * An answer that arrives while nobody waits for it stays on the row until the
 * renderer acts on it. Rows are partitioned by host identity and principal; a
 * row is never sent to another host or under another principal.
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { StartInputSchema, StartReceiptSchema } from "@nyte-ai/protocol";
import type { StartInput, StartReceipt } from "@nyte-ai/protocol";
import type { HostBinding } from "./registry.ts";

const DATABASE_NAME = "nyte-web-starts";

const DATABASE_VERSION = 1;

const STORE_NAME = "starts";

const storedStart = Type.Object(
  {
    key: Type.String(),
    hostId: Type.String({ minLength: 1 }),
    principal: Type.String({ minLength: 1 }),
    input: StartInputSchema,
    receipt: Type.Optional(StartReceiptSchema),
    at: Type.Number(),
  },
  { additionalProperties: false },
);

type StoredStart = Static<typeof storedStart>;

/** A start on record: what was sent, and the host's answer once one arrived that nobody took. */
export interface JournalRow {
  readonly input: StartInput;
  readonly receipt?: StartReceipt;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB failed")),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Could not open the start journal")),
      { once: true },
    );
  });
}

function keyOf(binding: HostBinding, requestId: string): string {
  return `${binding.hostId}|${binding.principal}|${requestId}`;
}

export interface StartJournal {
  /** On record before it is sent. An id already on record keeps its first input, which comes back. */
  record(row: { readonly binding: HostBinding; readonly input: StartInput }): Promise<StartInput>;
  /** The host answered a start nobody was waiting on; the answer stays until the renderer acts on it. */
  answer(row: {
    readonly binding: HostBinding;
    readonly requestId: string;
    readonly receipt: StartReceipt;
  }): Promise<void>;
  remove(row: { readonly binding: HostBinding; readonly requestId: string }): Promise<void>;
  /** Every start on record for this host and principal, oldest first. */
  list(binding: HostBinding): Promise<readonly JournalRow[]>;
}

function rowsOf(values: readonly StoredStart[], binding: HostBinding): readonly JournalRow[] {
  return values
    .filter((row) => row.hostId === binding.hostId && row.principal === binding.principal)
    .toSorted((left, right) => left.at - right.at)
    .map((row) =>
      row.receipt === undefined ? { input: row.input } : { input: row.input, receipt: row.receipt },
    );
}

export function createIndexedDbStartJournal(): StartJournal {
  let database: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> => (database ??= openDatabase());

  /** Read the row under `key` and write what `next` makes of it, in one transaction. */
  const change = async (
    key: string,
    next: (stored: StoredStart | undefined) => StoredStart | undefined,
  ): Promise<StoredStart | undefined> => {
    const db = await open();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const value: unknown = await requestResult(store.get(key));
    const stored = Value.Check(storedStart, value) ? value : undefined;
    const written = next(stored);

    if (written !== undefined && written !== stored) store.put(written);
    await transactionDone(transaction);

    return written;
  };

  return {
    record: async ({ binding, input }) => {
      const kept = await change(
        keyOf(binding, input.requestId),
        (stored) =>
          stored ?? {
            key: keyOf(binding, input.requestId),
            hostId: binding.hostId,
            principal: binding.principal,
            input,
            at: Date.now(),
          },
      );

      return kept?.input ?? input;
    },
    answer: async ({ binding, requestId, receipt }) => {
      await change(keyOf(binding, requestId), (stored) =>
        stored === undefined || stored.receipt !== undefined ? stored : { ...stored, receipt },
      );
    },
    remove: async ({ binding, requestId }) => {
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(keyOf(binding, requestId));
      await transactionDone(transaction);
    },
    list: async (binding) => {
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readonly");

      const values: readonly unknown[] = await requestResult(
        transaction.objectStore(STORE_NAME).getAll(),
      );

      await transactionDone(transaction);

      return rowsOf(
        values.filter((value) => Value.Check(storedStart, value)),
        binding,
      );
    },
  };
}

/** For tests and hosts without IndexedDB: rows live in memory for the page's life. */
export function createMemoryStartJournal(): StartJournal {
  const rows = new Map<string, StoredStart>();
  let clock = 0;

  return {
    record: async ({ binding, input }) => {
      const key = keyOf(binding, input.requestId);
      const stored = rows.get(key);

      if (stored !== undefined) return stored.input;
      rows.set(key, {
        key,
        hostId: binding.hostId,
        principal: binding.principal,
        input,
        at: (clock += 1),
      });

      return input;
    },
    answer: async ({ binding, requestId, receipt }) => {
      const key = keyOf(binding, requestId);
      const stored = rows.get(key);

      if (stored !== undefined && stored.receipt === undefined)
        rows.set(key, { ...stored, receipt });
    },
    remove: async ({ binding, requestId }) => {
      rows.delete(keyOf(binding, requestId));
    },
    list: async (binding) => rowsOf([...rows.values()], binding),
  };
}
