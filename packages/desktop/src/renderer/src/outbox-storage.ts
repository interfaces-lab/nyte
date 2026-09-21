import { Type } from "typebox";
import { Value } from "typebox/value";
import { userContent } from "../../shared/schemas.ts";
import type { OutboxSubmission, WorkspacePartition } from "./outbox.ts";
import { workspacePartitionFromStorage } from "./outbox.ts";
import { sessionId } from "@nyte-ai/protocol";

const DATABASE_NAME = "nyte-renderer";
const DATABASE_VERSION = 1;
const STORE_NAME = "outbox";

export interface PersistedOutboxRecordV1 {
  readonly version: 1;
  readonly workspace: WorkspacePartition;
  readonly key: string;
  readonly input: OutboxSubmission;
  readonly createdAt: number;
  readonly failures: number;
  readonly nextAttemptAt: number;
}

export interface OutboxStorage {
  readonly load: () => Promise<readonly PersistedOutboxRecordV1[]>;
  readonly put: (record: PersistedOutboxRecordV1) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
}

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
    version: Type.Literal(1),
    workspace: Type.String(),
    key: Type.String(),
    input: Type.Object(
      {
        sessionId: Type.String(),
        head: Type.Optional(Type.String()),
        content: userContent,
        delivery: Type.Optional(Type.Union([Type.Literal("steer"), Type.Literal("next")])),
        agent: Type.Optional(Type.String()),
      },
      strict,
    ),
    createdAt: Type.Number(),
    failures: Type.Integer({ minimum: 0 }),
    nextAttemptAt: Type.Number(),
  },
  strict,
);

function decodeRecord(value: unknown): PersistedOutboxRecordV1 | undefined {
  if (!Value.Check(storedRecord, value)) return undefined;
  try {
    return {
      version: 1,
      workspace: workspacePartitionFromStorage(value.workspace),
      key: value.key,
      input: {
        ...value.input,
        sessionId: sessionId(value.input.sessionId),
      },
      createdAt: value.createdAt,
      failures: value.failures,
      nextAttemptAt: value.nextAttemptAt,
    };
  } catch {
    return undefined;
  }
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
      () => reject(request.error ?? new Error("Could not open the outbox database")),
      { once: true },
    );
  });
}

export function createIndexedDbOutboxStorage(): OutboxStorage {
  const database = openDatabase();
  return {
    load: async () => {
      const db = await database;
      const transaction = db.transaction(STORE_NAME, "readonly");
      const values = await requestResult(transaction.objectStore(STORE_NAME).getAll());
      await transactionDone(transaction);
      return values.flatMap((value) => {
        const record = decodeRecord(value);
        return record === undefined ? [] : [record];
      });
    },
    put: async (record) => {
      const db = await database;
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(record);
      await transactionDone(transaction);
    },
    remove: async (key) => {
      const db = await database;
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(key);
      await transactionDone(transaction);
    },
  };
}
