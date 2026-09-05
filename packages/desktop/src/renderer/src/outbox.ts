/**
 * The client outbox (kernel README, "A submitted message is never lost").
 *
 * The core covers everything after a receipt. The gap between Enter and the
 * receipt is the client's: on Enter a row is minted with an idempotency key
 * and drawn at once; a failed submit keeps the row and retries with the same
 * key until it succeeds or the user cancels it. `queued` and `duplicate` both
 * mean the message is durable, so a retry after a lost reply cannot send it
 * twice.
 */
import type { Oid, SendInput, SendReceipt, SessionId } from "@nyte-ai/core";
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
  readonly at: number;
  readonly state: OutboxRowState;
}

const SAVING: OutboxRowState = { kind: "saving" };
const SENDING: OutboxRowState = { kind: "sending" };

export type OutboxSubmission = Omit<SendInput, "key">;

export interface OutboxOptions {
  readonly send: (input: SendInput) => Promise<SendReceipt>;
  /** Runs once a receipt makes the message durable, before its row leaves the outbox. */
  readonly settled?: (sessionId: SessionId, change: Oid) => Promise<void>;
  /** Defer `run` by `delayMs`; returns the cancel. Defaults to `setTimeout`. */
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
  readonly now?: () => number;
  readonly mintKey?: () => string;
  readonly storage?: OutboxStorage;
}

export interface Outbox {
  /** Mint a key, draw the row, and start submitting. Returns the key. */
  readonly submit: (input: OutboxSubmission) => string;
  /** Persist the row before submission starts. Resolves once durable ownership transfers. */
  readonly submitDurably: (input: OutboxSubmission) => Promise<string>;
  /** Hydrate every persisted row and activate one resolved workspace partition. */
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
  const send = options.send;
  const settled = options.settled ?? (() => Promise.resolve());
  const schedule = options.schedule ?? scheduleWithTimeout;
  const now = options.now ?? Date.now;
  const mintKey = options.mintKey ?? (() => crypto.randomUUID());
  const storage = options.storage;

  let rows: readonly OutboxRow[] = [];
  let records = new Map<string, PersistedOutboxRecordV1>();
  let activeWorkspace: WorkspacePartition | undefined;
  let hydrated = false;
  let hydrationError: unknown;
  let activation = 0;
  const retries = new Map<string, () => void>();
  const inFlight = new Set<string>();
  const cancelled = new Set<string>();
  /** Why each key's latest submit failed. Not persisted: a reload starts as sending. */
  const reasons = new Map<string, string>();
  const listeners = new Set<() => void>();

  const failed = (key: string, cause: unknown): OutboxRowState => {
    const reason = errorMessage(cause);
    reasons.set(key, reason);
    return { kind: "failed", reason };
  };

  const stateOf = (key: string): OutboxRowState => {
    const reason = reasons.get(key);
    return reason === undefined ? SENDING : { kind: "failed", reason };
  };

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const rowFor = (key: string): OutboxRow | undefined => rows.find((row) => row.key === key);

  const drop = (key: string): void => {
    reasons.delete(key);
    if (rowFor(key) === undefined) return;
    rows = rows.filter((row) => row.key !== key);
    notify();
  };

  const cancelRetries = (): void => {
    for (const cancel of retries.values()) cancel();
    retries.clear();
  };

  const visibleRows = (): readonly OutboxRow[] =>
    [...records.values()]
      .filter((record) => record.workspace === activeWorkspace)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((record) => ({
        key: record.key,
        sessionId: record.input.sessionId,
        content: record.input.content,
        at: record.createdAt,
        state: stateOf(record.key),
      }));

  const scheduleRecord = (record: PersistedOutboxRecordV1): void => {
    if (
      record.workspace !== activeWorkspace ||
      retries.has(record.key) ||
      inFlight.has(record.key)
    ) {
      return;
    }
    const delayMs = Math.max(0, record.nextAttemptAt - now());
    retries.set(
      record.key,
      schedule(() => {
        retries.delete(record.key);
        void attemptPersisted(record.key, record.workspace);
      }, delayMs),
    );
  };

  const attemptPersisted = async (key: string, workspace: WorkspacePartition): Promise<void> => {
    const record = records.get(key);
    if (
      record === undefined ||
      record.workspace !== workspace ||
      activeWorkspace !== workspace ||
      inFlight.has(key)
    ) {
      return;
    }
    inFlight.add(key);
    let receipt: SendReceipt;
    try {
      receipt = await send({ ...record.input, key: record.key });
    } catch (cause) {
      const current = records.get(key);
      if (
        current === undefined ||
        current.workspace !== workspace ||
        activeWorkspace !== workspace
      ) {
        inFlight.delete(key);
        return;
      }
      failed(key, cause);
      const failures = current.failures + 1;
      const updated: PersistedOutboxRecordV1 = {
        ...current,
        failures,
        nextAttemptAt: now() + retryDelayMs(failures),
      };
      records.set(key, updated);
      rows = visibleRows();
      notify();
      try {
        await storage?.put(updated);
      } catch {
        const delayed = { ...updated, nextAttemptAt: now() + retryDelayMs(failures) };
        records.set(key, delayed);
        inFlight.delete(key);
        scheduleRecord(delayed);
        return;
      }
      inFlight.delete(key);
      scheduleRecord(updated);
      return;
    }
    const current = records.get(key);
    if (current === undefined || current.workspace !== workspace || activeWorkspace !== workspace) {
      inFlight.delete(key);
      return;
    }
    await settled(current.input.sessionId, receipt.change).catch(() => undefined);
    records.delete(key);
    reasons.delete(key);
    rows = visibleRows();
    notify();
    await storage?.remove(key).catch(() => undefined);
    inFlight.delete(key);
  };

  const attempt = async (key: string, input: SendInput, failures = 0): Promise<void> => {
    let receipt: SendReceipt;
    try {
      receipt = await send(input);
    } catch (cause) {
      const row = rowFor(key);
      if (row === undefined) return;
      const state = failed(key, cause);
      rows = rows.map((candidate) => (candidate.key === key ? { ...row, state } : candidate));
      notify();
      retries.set(
        key,
        schedule(
          () => {
            retries.delete(key);
            void attempt(key, input, failures + 1);
          },
          retryDelayMs(failures + 1),
        ),
      );
      return;
    }
    // `queued` and `duplicate` both say the store has the message.
    if (rowFor(key) === undefined) return;
    await settled(input.sessionId, receipt.change).catch(() => undefined);
    drop(key);
  };

  const submit = (input: OutboxSubmission): string => {
    const key = mintKey();
    rows = [
      ...rows,
      { key, sessionId: input.sessionId, content: input.content, at: now(), state: SENDING },
    ];
    notify();
    void attempt(key, { ...input, key });
    return key;
  };

  return {
    submit,
    submitDurably: async (input) => {
      if (storage === undefined) return submit(input);
      if (!hydrated || activeWorkspace === undefined) {
        throw new Error("The message outbox is not ready");
      }
      if (hydrationError !== undefined) throw hydrationError;
      const key = mintKey();
      const createdAt = now();
      const record: PersistedOutboxRecordV1 = {
        version: 1,
        workspace: activeWorkspace,
        key,
        input,
        createdAt,
        failures: 0,
        nextAttemptAt: createdAt,
      };
      rows = [
        ...rows,
        {
          key,
          sessionId: input.sessionId,
          content: input.content,
          at: createdAt,
          state: SAVING,
        },
      ];
      notify();
      try {
        await storage.put(record);
      } catch (cause) {
        cancelled.delete(key);
        drop(key);
        throw cause;
      }
      if (cancelled.delete(key)) {
        await storage.remove(key).catch(() => undefined);
        return key;
      }
      records.set(key, record);
      rows = visibleRows();
      notify();
      void attemptPersisted(key, record.workspace);
      return key;
    },
    activate: async (workspace) => {
      const currentActivation = ++activation;
      activeWorkspace = workspace;
      cancelRetries();
      rows = [];
      notify();
      if (!hydrated && storage !== undefined) {
        try {
          const loaded = await storage.load();
          if (currentActivation !== activation) return;
          records = new Map(loaded.map((record) => [record.key, record]));
        } catch (cause) {
          if (currentActivation !== activation) return;
          hydrationError = cause;
        }
        hydrated = true;
      } else {
        hydrated = true;
      }
      if (currentActivation !== activation || activeWorkspace !== workspace) return;
      rows = visibleRows();
      notify();
      for (const record of records.values()) scheduleRecord(record);
    },
    cancel: (key) => {
      retries.get(key)?.();
      retries.delete(key);
      if (rowFor(key)?.state.kind === "saving") cancelled.add(key);
      if (records.has(key)) {
        records.delete(key);
        void storage?.remove(key).catch(() => undefined);
      }
      drop(key);
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
