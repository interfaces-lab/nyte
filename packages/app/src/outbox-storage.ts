/**
 * The outbox's IndexedDB storage, partitioned by where a row was written: the
 * host and principal the renderer was bound to, and the workspace that was
 * open. A row is loaded only under the same binding, because its session
 * lives in that host's store and was queued under that principal; a row from
 * a store that knew no binding is never replayed against whichever host
 * connects next.
 */
import { Type } from "typebox";
import { Value } from "typebox/value";
import { schemas, sessionId } from "@nyte-ai/protocol";
import type { OutboxRecord, OutboxStorage } from "@nyte-ai/client";
import { userContent } from "./schemas.ts";

const DATABASE_NAME = "nyte-renderer";

const DATABASE_VERSION = 2;

const STORE_NAME = "outbox";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB failed")),
      {
        once: true,
      },
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

const strict = { additionalProperties: false };

const storedRecord = Type.Object(
  {
    /** The host identity and principal the row was queued under; null where the host is this machine. */
    host: Type.Union([Type.String(), Type.Null()]),
    principal: Type.Union([Type.String(), Type.Null()]),
    /** The workspace path, or null for the home host. */
    workspace: Type.Union([Type.String(), Type.Null()]),
    key: Type.String(),
    input: Type.Object(
      {
        sessionId: Type.String(),
        head: Type.Optional(Type.String()),
        content: userContent,
        source: Type.Optional(schemas.MessageSource),
        delivery: Type.Optional(Type.Union([Type.Literal("steer"), Type.Literal("next")])),
        agent: Type.Optional(Type.String()),
      },
      strict,
    ),
    at: Type.Number(),
  },
  strict,
);

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener(
      "upgradeneeded",
      () => {
        // Rows from before the binding partition name no host; they are not replayed anywhere.
        if (request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.deleteObjectStore(STORE_NAME);
        }

        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Could not open the outbox database")),
      { once: true },
    );
  });
}

/** Where rows belong: the host and principal the renderer is bound to, and the open workspace. */
export interface OutboxPartition {
  readonly host: string | null;
  readonly principal: string | null;
  readonly workspace: string | null;
}

export interface WorkspaceOutboxStorage extends OutboxStorage {
  /** Rows written from now on belong to this partition, and `load` answers only its rows. */
  readonly select: (partition: OutboxPartition) => void;
}

export function createIndexedDbOutboxStorage(): WorkspaceOutboxStorage {
  // Opened on first use, so importing the outbox costs nothing where IndexedDB is absent.
  let database: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> => (database ??= openDatabase());
  let partition: OutboxPartition = { host: null, principal: null, workspace: null };

  return {
    select: (selected) => {
      partition = selected;
    },
    load: async () => {
      const scope = partition;
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readonly");
      const values = await requestResult(transaction.objectStore(STORE_NAME).getAll());
      await transactionDone(transaction);
      const records: OutboxRecord[] = [];

      for (const value of values) {
        if (
          !Value.Check(storedRecord, value) ||
          value.host !== scope.host ||
          value.principal !== scope.principal ||
          value.workspace !== scope.workspace
        )
          continue;

        try {
          records.push({
            key: value.key,
            input: { ...value.input, sessionId: sessionId(value.input.sessionId) },
            at: value.at,
          });
        } catch {
          // A malformed session id names nothing this host can send to.
        }
      }

      return records;
    },
    // The partition is read when the call is made: a selection that lands while
    // the database opens names the next lifetime's rows, not this one's.
    put: async (record) => {
      const scope = partition;
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ ...scope, ...record });
      await transactionDone(transaction);
    },
    remove: async (key) => {
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(key);
      await transactionDone(transaction);
    },
  };
}
