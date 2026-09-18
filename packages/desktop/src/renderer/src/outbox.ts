/**
 * The client outbox (kernel README, "A submitted message is never lost").
 *
 * The core covers everything after a receipt. The gap between Enter and the
 * receipt is the client's: on Enter a row is minted with an idempotency key,
 * persisted, and drawn at once; a failed submit keeps the row and retries with
 * the same key until it succeeds or the user cancels it. `queued` and
 * `duplicate` both mean the message is durable, so a retry after a lost reply
 * cannot send it twice.
 *
 * Every row is a persisted record. The rows on screen are the records of the
 * active workspace partition, oldest first, plus a transient state per key.
 */
import type { Lane, Oid, SendInput, SendReceipt, SessionId } from "@nyte-ai/protocol";
import type { UserMessage } from "@nyte-ai/schema";
import type { OutboxStorage, PersistedOutboxRecordV1 } from "./outbox-storage.ts";
import { errorMessage } from "../../shared/errors.ts";

declare const workspacePartitionBrand: unique symbol;
export type WorkspacePartition = string & { readonly [workspacePartitionBrand]: true };

function makeWorkspacePartition(value: string): WorkspacePartition {
  // SAFETY: All callers construct or validate the renderer's workspace namespace.
  return value as WorkspacePartition;
}

export const HOME_WORKSPACE_PARTITION = makeWorkspacePartition("home");

export function workspacePartition(path: string): WorkspacePartition {
  return makeWorkspacePartition(`workspace:${path}`);
}

export function workspacePartitionFromStorage(value: string): WorkspacePartition {
  if (value !== "home" && !value.startsWith("workspace:")) {
    throw new Error("Invalid persisted workspace partition");
  }
  return makeWorkspacePartition(value);
}

/** Where a row is between Enter and its receipt. A failed row is waiting to retry. */
export type OutboxRowState =
  | { readonly kind: "saving" }
  | { readonly kind: "sending" }
  | { readonly kind: "failed"; readonly reason: string };

export interface OutboxRow {
  readonly key: string;
  readonly sessionId: SessionId;
  readonly content: UserMessage["content"];
  /** The lane the submission named; absent means the landing policy's first lane. */
  readonly lane: Lane | undefined;
  readonly at: number;
  readonly state: OutboxRowState;
}

const SAVING: OutboxRowState = { kind: "saving" };
const SENDING: OutboxRowState = { kind: "sending" };

export type OutboxSubmission = Omit<SendInput, "key">;

interface OutboxOptions {
  readonly storage: OutboxStorage;
  readonly send: (input: SendInput) => Promise<SendReceipt>;
  /** Runs once a receipt makes the message durable, before its row leaves the outbox. */
  readonly settled?: (sessionId: SessionId, change: Oid) => Promise<void>;
  /** Defer `run` by `delayMs`; returns the cancel. Defaults to `setTimeout`. */
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
  readonly now?: () => number;
  readonly mintKey?: () => string;
}

export interface Outbox {
  /** Mint a key, draw the row, persist it, and start submitting. Resolves to the key once durable. */
  readonly submit: (input: OutboxSubmission) => Promise<string>;
  /** Hydrate every persisted row and show one workspace partition's rows, retrying them. */
  readonly activate: (workspace: WorkspacePartition) => Promise<void>;
  /** Stop retrying and drop the row. A submit already in flight may still land. */
  readonly cancel: (key: string) => void;
  /** Every row still waiting for a receipt, oldest first. Stable until the outbox changes. */
  readonly rows: () => readonly OutboxRow[];
  readonly subscribe: (listener: () => void) => () => void;
}

/** Retry delay after `failures` failed submits: 500ms doubling, capped at ten seconds. */
export function retryDelayMs(failures: number): number {
  return Math.min(500 * 2 ** Math.max(0, failures - 1), 10_000);
}

function scheduleWithTimeout(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
}

export function createOutbox(options: OutboxOptions): Outbox {
  const storage = options.storage;
  const send = options.send;
  const settled = options.settled ?? (() => Promise.resolve());
  const schedule = options.schedule ?? scheduleWithTimeout;
  const now = options.now ?? Date.now;
  const mintKey = options.mintKey ?? (() => crypto.randomUUID());

  /** Every row, across partitions. A record is here from Enter until its receipt or cancel. */
  const records = new Map<string, PersistedOutboxRecordV1>();
  /** Not persisted: a reload starts every row as sending. Absent means sending. */
  const states = new Map<string, OutboxRowState>();
  const retries = new Map<string, () => void>();
  const inFlight = new Set<string>();
  const listeners = new Set<() => void>();
  let active: WorkspacePartition | undefined;
  let generation = 0;
  let hydrated = false;
  let hydrationError: unknown;
  let rows: readonly OutboxRow[] = [];

  const refresh = (): void => {
    rows = [...records.values()]
      .filter((record) => record.workspace === active)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((record) => ({
        key: record.key,
        sessionId: record.input.sessionId,
        content: record.input.content,
        lane: record.input.lane,
        at: record.createdAt,
        state: states.get(record.key) ?? SENDING,
      }));
    for (const listener of listeners) listener();
  };

  const forget = (key: string): void => {
    records.delete(key);
    states.delete(key);
    refresh();
  };

  /** Still the same row, in the partition on screen. False after a cancel or a workspace switch. */
  const current = (record: PersistedOutboxRecordV1): boolean =>
    records.get(record.key) === record && record.workspace === active;

  const scheduleAttempt = (record: PersistedOutboxRecordV1): void => {
    if (record.workspace !== active || retries.has(record.key)) return;
    retries.set(
      record.key,
      schedule(
        () => {
          retries.delete(record.key);
          void attempt(record.key);
        },
        Math.max(0, record.nextAttemptAt - now()),
      ),
    );
  };

  const attempt = async (key: string): Promise<void> => {
    const record = records.get(key);
    if (record === undefined || record.workspace !== active || inFlight.has(key)) return;
    inFlight.add(key);
    try {
      let receipt: SendReceipt;
      try {
        receipt = await send({ ...record.input, key });
      } catch (cause) {
        if (!current(record)) return;
        const failures = record.failures + 1;
        const updated = { ...record, failures, nextAttemptAt: now() + retryDelayMs(failures) };
        records.set(key, updated);
        states.set(key, { kind: "failed", reason: errorMessage(cause) });
        refresh();
        // A lost write only forgets the backoff; the row itself is already stored.
        await storage.put(updated).catch(() => undefined);
        scheduleAttempt(updated);
        return;
      }
      if (!current(record)) return;
      // `queued` and `duplicate` both say the store has the message.
      await settled(record.input.sessionId, receipt.change).catch(() => undefined);
      forget(key);
      await storage.remove(key).catch(() => undefined);
    } finally {
      inFlight.delete(key);
    }
  };

  return {
    submit: async (input) => {
      if (!hydrated || active === undefined) throw new Error("The message outbox is not ready");
      if (hydrationError !== undefined) throw hydrationError;
      const key = mintKey();
      const createdAt = now();
      const record: PersistedOutboxRecordV1 = {
        version: 1,
        workspace: active,
        key,
        input,
        createdAt,
        failures: 0,
        nextAttemptAt: createdAt,
      };
      records.set(key, record);
      states.set(key, SAVING);
      refresh();
      try {
        await storage.put(record);
      } catch (cause) {
        forget(key);
        throw cause;
      }
      // Cancelled while saving: the write landed, so take it back.
      if (!records.has(key)) {
        await storage.remove(key).catch(() => undefined);
        return key;
      }
      states.delete(key);
      refresh();
      void attempt(key);
      return key;
    },
    activate: async (workspace) => {
      const activation = ++generation;
      active = workspace;
      for (const cancel of retries.values()) cancel();
      retries.clear();
      refresh();
      if (!hydrated) {
        try {
          const loaded = await storage.load();
          if (activation !== generation) return;
          for (const record of loaded) records.set(record.key, record);
        } catch (cause) {
          if (activation !== generation) return;
          hydrationError = cause;
        }
        hydrated = true;
      }
      if (activation !== generation) return;
      refresh();
      for (const record of records.values()) scheduleAttempt(record);
    },
    cancel: (key) => {
      retries.get(key)?.();
      retries.delete(key);
      const record = records.get(key);
      if (record === undefined) return;
      const saving = states.get(key) === SAVING;
      forget(key);
      // A saving row is removed by its own submit once the write lands.
      if (!saving) void storage.remove(key).catch(() => undefined);
    },
    rows: () => rows,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
