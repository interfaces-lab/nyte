/**
 * The outbox's IndexedDB storage, partitioned by workspace: a row is stored
 * under the workspace it was written in and loaded only while that workspace
 * is open, because its session lives in that workspace's host.
 */
import { Type } from "typebox";
import { Value } from "typebox/value";
import { schemas, sessionId } from "@nyte-ai/protocol";
import type { OutboxRecord, OutboxStorage } from "@nyte-ai/client";
import { userContent } from "../../shared/schemas.ts";

const DATABASE_NAME = "nyte-renderer";

const DATABASE_VERSION = 1;

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
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
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

export interface WorkspaceOutboxStorage extends OutboxStorage {
  /** Rows written from now on belong to this workspace, and `load` answers only its rows. */
  readonly select: (workspace: string | null) => void;
}

export function createIndexedDbOutboxStorage(): WorkspaceOutboxStorage {
  // Opened on first use, so importing the outbox costs nothing where IndexedDB is absent.
  let database: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> => (database ??= openDatabase());
  let workspace: string | null = null;

  return {
    select: (selected) => {
      workspace = selected;
    },
    load: async () => {
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readonly");
      const values = await requestResult(transaction.objectStore(STORE_NAME).getAll());
      await transactionDone(transaction);
      const records: OutboxRecord[] = [];

      for (const value of values) {
        if (!Value.Check(storedRecord, value) || value.workspace !== workspace) continue;

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
    put: async (record) => {
      const db = await open();
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ workspace, ...record });
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
