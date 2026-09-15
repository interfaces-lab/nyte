/**
 * The client outbox (design record, "A submitted message is never lost").
 *
 * Core cannot see the gap between Enter and its receipt, so the client closes
 * it: every Enter mints one idempotency key, keeps the message locally as
 * `sending`, and retries the same key with backoff until the store answers.
 * `queued` and `duplicate` both mean durable, so a retry after a lost
 * response finds the first submission and sends nothing twice. Only the user
 * takes a sending message back.
 */
import type { Lane, Oid, SendReceipt } from "@nyte-ai/core";
import type { UserMessage } from "@nyte-ai/schema";

export interface OutboxEntry {
  readonly key: string;
  readonly lane: Lane;
  readonly content: UserMessage["content"];
  readonly at: number;
  /** Attempts made so far, for the row's own status. */
  readonly attempts: number;
  readonly lastError?: string;
}

type OutboxOutcome =
  | { readonly kind: "durable"; readonly change: Oid; readonly key: string }
  | { readonly kind: "withdrawn"; readonly key: string };

interface OutboxDependencies {
  readonly send: (input: {
    readonly key: string;
    readonly lane: Lane;
    readonly content: UserMessage["content"];
  }) => Promise<SendReceipt>;
  /** Waits before a retry; a test passes one that returns at once. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly now?: () => number;
  readonly mintKey?: () => string;
  /** Called whenever the set of sending entries changes. */
  readonly onChange?: (entries: readonly OutboxEntry[]) => void;
  /** Called with the store's answer, just before the entry leaves `entries`. */
  readonly onReceipt?: (entry: OutboxEntry, receipt: SendReceipt) => void;
}

const FIRST_DELAY_MS = 250;
const MAX_DELAY_MS = 10_000;

/** Exponential backoff with a ceiling: 250ms, 500ms, 1s, … capped at ten seconds. */
function retryDelay(attempt: number): number {
  return Math.min(MAX_DELAY_MS, FIRST_DELAY_MS * 2 ** Math.max(0, attempt - 1));
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

interface InFlight {
  entry: OutboxEntry;
  readonly stop: AbortController;
  readonly settled: PromiseWithResolvers<OutboxOutcome>;
}

export class Outbox {
  private readonly dependencies: OutboxDependencies;
  private readonly inFlight = new Map<string, InFlight>();

  constructor(dependencies: OutboxDependencies) {
    this.dependencies = dependencies;
  }

  /** Messages still waiting for a receipt, oldest first. */
  get entries(): readonly OutboxEntry[] {
    return [...this.inFlight.values()].map((flight) => flight.entry);
  }

  /**
   * Submit and keep submitting. Resolves once the store holds the message or
   * the user withdrew it; never rejects, because a failed request is a reason
   * to retry, not an outcome.
   */
  submit(input: {
    readonly content: UserMessage["content"];
    readonly lane: Lane;
  }): Promise<OutboxOutcome> {
    const key = this.dependencies.mintKey?.() ?? crypto.randomUUID();
    const stop = new AbortController();
    const flight: InFlight = {
      entry: {
        key,
        lane: input.lane,
        content: input.content,
        at: this.dependencies.now?.() ?? Date.now(),
        attempts: 0,
      },
      stop,
      settled: Promise.withResolvers<OutboxOutcome>(),
    };
    this.inFlight.set(key, flight);
    this.changed();
    return this.deliver(flight);
  }

  /** Stop retrying, then report whether the in-flight attempt reached the store. */
  withdraw(key: string): Promise<OutboxOutcome> | undefined {
    const flight = this.inFlight.get(key);
    if (flight === undefined) return undefined;
    flight.stop.abort();
    return flight.settled.promise;
  }

  private async deliver(flight: InFlight): Promise<OutboxOutcome> {
    const { key, lane, content } = flight.entry;
    const sleep = this.dependencies.sleep ?? defaultSleep;
    for (;;) {
      if (flight.stop.signal.aborted) return this.settle(flight, { kind: "withdrawn", key });
      flight.entry = { ...flight.entry, attempts: flight.entry.attempts + 1 };
      this.changed();
      try {
        const receipt = await this.dependencies.send({ key, lane, content });
        this.dependencies.onReceipt?.(flight.entry, receipt);
        return this.settle(flight, { kind: "durable", change: receipt.change, key });
      } catch (cause) {
        flight.entry = { ...flight.entry, lastError: errorMessage(cause) };
        this.changed();
      }
      await sleep(retryDelay(flight.entry.attempts), flight.stop.signal);
    }
  }

  private settle(flight: InFlight, outcome: OutboxOutcome): OutboxOutcome {
    this.inFlight.delete(flight.entry.key);
    flight.settled.resolve(outcome);
    this.changed();
    return outcome;
  }

  private changed(): void {
    this.dependencies.onChange?.(this.entries);
  }
}
