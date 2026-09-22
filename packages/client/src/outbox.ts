/**
 * The client outbox (kernel README, "A submitted message is never lost").
 *
 * Core covers everything after a receipt. The gap between Enter and the
 * receipt is the client's: Enter mints one idempotency key, draws the message
 * as a row, and retries the same key with backoff until the store answers or
 * the user withdraws it. `queued` and `duplicate` both mean durable, so a
 * retry after a lost reply cannot send twice.
 *
 * A receipt ends retries, not the row. The receipt and the watch arrive on
 * separate channels, so the row stays, durable and named by its change, until
 * `observe` hears the fold draw the same key or withdraw the same change. The
 * message never blinks out between the two, and is never drawn twice.
 *
 * Storage is optional. With it, a row is written before its first send and
 * removed at its receipt, so `activate` resumes every unsent message after a
 * reload under its original key.
 */
import type { Oid, SendInput, SendReceipt } from "@nyte-ai/protocol";
import type { SessionUpdate } from "./session/session-follow.ts";
import type { SessionState } from "./session/session-state.ts";

export type OutboxSubmission = Omit<SendInput, "key">;

export type OutboxRowState =
  /** Written to storage before its first send. */
  | { readonly kind: "storing" }
  | { readonly kind: "sending"; readonly attempts: number }
  | { readonly kind: "retrying"; readonly attempts: number; readonly reason: string }
  /** The store holds the message; the row waits for the watch to draw it. */
  | { readonly kind: "durable"; readonly change: Oid };

export interface OutboxRow {
  readonly key: string;
  readonly input: OutboxSubmission;
  readonly at: number;
  readonly state: OutboxRowState;
}

export type OutboxOutcome =
  | { readonly kind: "durable"; readonly change: Oid }
  | { readonly kind: "withdrawn" };

export type OutboxRecord = Pick<OutboxRow, "key" | "input" | "at">;

export interface OutboxStorage {
  readonly load: () => Promise<readonly OutboxRecord[]>;
  readonly put: (record: OutboxRecord) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
}

export interface OutboxOptions {
  readonly send: (input: SendInput) => Promise<SendReceipt>;
  readonly storage?: OutboxStorage;
  /** Defer `run` by `delayMs`; returns the cancel. Defaults to `setTimeout`. */
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
  readonly now?: () => number;
  readonly mintKey?: () => string;
}

export interface Outbox {
  /** Mint a key, draw the row, store it, and start sending. Resolves to the key once stored. */
  readonly submit: (input: OutboxSubmission) => Promise<string>;
  /** Stop retrying and drop the row; answers whether an attempt already reached the store. */
  readonly withdraw: (key: string) => Promise<OutboxOutcome> | undefined;
  /** The observer published an update; durable rows it draws or withdraws leave. */
  readonly observe: (update: SessionUpdate) => void;
  /** Replace the rows with what storage holds and send them. */
  readonly activate: () => Promise<void>;
  /** Oldest first. Stable until the outbox changes. */
  readonly rows: () => readonly OutboxRow[];
  readonly subscribe: (listener: () => void) => () => void;
}

/** Retry delay after `attempts` failed sends: 500ms doubling, capped at ten seconds. */
export function retryDelayMs(attempts: number): number {
  return Math.min(500 * 2 ** Math.max(0, attempts - 1), 10_000);
}

function scheduleWithTimeout(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The identities a fold's message shares with a receipt: the key `send` carried, the change it named. */
interface Named {
  readonly key?: string;
  readonly change?: Oid;
}

function drawn(update: SessionUpdate): readonly Named[] {
  switch (update.kind) {
    case "snapshot":
      return drawnBy(update.state);
    case "event":
      switch (update.event.kind) {
        case "queued":
          return [update.event.item];
        case "commit":
          return [update.event.item.commit];
        case "queue_cancelled":
          return [update.event];
        default:
          return [];
      }
    case "metadata":
      return [];
    default: {
      const _exhaustive: never = update;
      return _exhaustive;
    }
  }
}

function drawnBy(state: SessionState): Named[] {
  const names: Named[] = [...state.pending];
  for (const turn of state.transcript.items) {
    if (turn.kind !== "turn") continue;
    for (const part of turn.parts) {
      if (part.kind === "user" && part.key !== undefined) names.push({ key: part.key });
    }
  }
  return names;
}

interface Flight {
  row: OutboxRow;
  observed: boolean;
  cancelRetry: (() => void) | undefined;
  settled: PromiseWithResolvers<OutboxOutcome>;
}

export function createOutbox(options: OutboxOptions): Outbox {
  const schedule = options.schedule ?? scheduleWithTimeout;
  const now = options.now ?? Date.now;
  const mintKey = options.mintKey ?? (() => crypto.randomUUID());
  const flights = new Map<string, Flight>();
  const listeners = new Set<() => void>();
  let rows: readonly OutboxRow[] = [];

  const refresh = (): void => {
    rows = [...flights.values()].map((flight) => flight.row).sort((a, b) => a.at - b.at);
    for (const listener of listeners) listener();
  };

  const settle = (flight: Flight, outcome: OutboxOutcome): void => {
    if (flights.get(flight.row.key) === flight) flights.delete(flight.row.key);
    flight.cancelRetry?.();
    flight.settled.resolve(outcome);
    refresh();
  };

  const draw = (flight: Flight, state: OutboxRowState): void => {
    flight.row = { ...flight.row, state };
    refresh();
  };

  /** Still the flight the map holds; false once withdrawn or replaced by an activation. */
  const current = (flight: Flight): boolean => flights.get(flight.row.key) === flight;

  const attempt = async (flight: Flight, attempts: number): Promise<void> => {
    const { key, input } = flight.row;
    draw(flight, { kind: "sending", attempts });
    let receipt: SendReceipt;
    try {
      receipt = await options.send({ ...input, key });
    } catch (cause) {
      if (!current(flight)) {
        flight.row = {
          ...flight.row,
          state: { kind: "retrying", attempts, reason: errorMessage(cause) },
        };
        flight.settled.resolve({ kind: "withdrawn" });
        return;
      }
      draw(flight, { kind: "retrying", attempts, reason: errorMessage(cause) });
      flight.cancelRetry = schedule(() => {
        flight.cancelRetry = undefined;
        void attempt(flight, attempts + 1);
      }, retryDelayMs(attempts));
      return;
    }
    // `queued` and `duplicate` both say the store has the message.
    void options.storage?.remove(key).catch(() => undefined);
    const durable: OutboxOutcome = { kind: "durable", change: receipt.change };
    if (!current(flight)) {
      flight.row = { ...flight.row, state: durable };
      flight.settled.resolve(durable);
    } else if (flight.observed) {
      settle(flight, durable);
    } else {
      draw(flight, durable);
    }
  };

  const open = (record: OutboxRecord): Flight => {
    const flight: Flight = {
      row: { ...record, state: { kind: "storing" } },
      observed: false,
      cancelRetry: undefined,
      settled: Promise.withResolvers(),
    };
    flights.set(record.key, flight);
    refresh();
    return flight;
  };

  const removeStored = (key: string): Promise<void> =>
    options.storage?.remove(key) ?? Promise.resolve();

  const restoreWithdrawal = (flight: Flight): void => {
    if (flights.has(flight.row.key)) return;
    flight.settled = Promise.withResolvers();
    flights.set(flight.row.key, flight);
    const state = flight.row.state;
    if (state.kind === "retrying") {
      flight.cancelRetry = schedule(() => {
        flight.cancelRetry = undefined;
        void attempt(flight, state.attempts + 1);
      }, retryDelayMs(state.attempts));
    }
    refresh();
  };

  let activation = 0;

  return {
    submit: async (input) => {
      const record: OutboxRecord = { key: mintKey(), input, at: now() };
      const flight = open(record);
      try {
        await options.storage?.put(record);
      } catch (cause) {
        settle(flight, { kind: "withdrawn" });
        throw cause;
      }
      // Withdrawn while the write was landing: take the write back.
      if (!current(flight)) void options.storage?.remove(record.key).catch(() => undefined);
      else void attempt(flight, 1);
      return record.key;
    },
    withdraw: (key) => {
      const flight = flights.get(key);
      if (flight === undefined) return undefined;
      const { state } = flight.row;
      flight.cancelRetry?.();
      flight.cancelRetry = undefined;
      flights.delete(key);
      refresh();
      switch (state.kind) {
        case "storing":
          settle(flight, { kind: "withdrawn" });
          return flight.settled.promise;
        case "sending": {
          const outcome = flight.settled.promise;
          return Promise.all([outcome, removeStored(key)])
            .then(([settled]) => settled)
            .catch((cause: unknown) => {
              restoreWithdrawal(flight);
              throw cause;
            });
        }
        case "retrying":
          return removeStored(key)
            .then(() => {
              const outcome = { kind: "withdrawn" } as const;
              flight.settled.resolve(outcome);
              return outcome;
            })
            .catch((cause: unknown) => {
              restoreWithdrawal(flight);
              throw cause;
            });
        case "durable":
          return removeStored(key)
            .then(() => {
              const outcome = { kind: "durable", change: state.change } as const;
              flight.settled.resolve(outcome);
              return outcome;
            })
            .catch((cause: unknown) => {
              restoreWithdrawal(flight);
              throw cause;
            });
        default: {
          const _exhaustive: never = state;
          return _exhaustive;
        }
      }
    },
    observe: (update) => {
      const names = drawn(update);
      if (names.length === 0) return;
      for (const flight of flights.values()) {
        if (flight.row.input.sessionId !== update.state.sessionId) continue;
        const { state } = flight.row;
        const shown = names.some(
          (name) =>
            name.key === flight.row.key ||
            (state.kind === "durable" && name.change === state.change),
        );
        if (!shown) continue;
        if (state.kind === "durable") {
          settle(flight, { kind: "durable", change: state.change });
        } else {
          flight.observed = true;
        }
      }
    },
    activate: async () => {
      const generation = ++activation;
      for (const flight of flights.values()) flight.cancelRetry?.();
      flights.clear();
      refresh();
      const records = (await options.storage?.load()) ?? [];
      if (generation !== activation) return;
      for (const record of records) void attempt(open(record), 1);
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
