import type { Disposer, SdkError } from "@nyte-ai/schema";
import { decodeOutput, encodeInput } from "@nyte-ai/protocol";
import type { CallName, HostSocket, OperationInput, OperationOutput } from "@nyte-ai/protocol";

export interface Live<T> {
  subscribe(listener: () => void): Disposer;
  snapshot(): T;
}

export type Freshness =
  | { readonly kind: "fresh"; readonly seq: number }
  | { readonly kind: "stale"; readonly since: number; readonly error: SdkError | null };

export interface Attachment {
  attach(socket: HostSocket, subscribe: () => Promise<void>): void;
  detach(): void;
}

export interface FreshnessCell {
  readonly current: () => Freshness;
  readonly stale: (error: SdkError | null) => boolean;
  readonly fresh: (seq: number) => boolean;
}

export interface Retries {
  readonly failed: (run: () => void) => void;
  readonly reset: () => void;
}

const RETRY_BASE_MS = 250;

const RETRY_MAX_MS = 30_000;

/** The one retry curve: a dial, a resumed watch and a held send each wait this long before attempt `attempt + 1`. */
export function retryDelay(attempt: number): number {
  return jittered(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt));
}

export function jittered(ceiling: number): number {
  return ceiling / 2 + (Math.random() * ceiling) / 2;
}

export function freshnessCell(): FreshnessCell {
  let value: Freshness = { kind: "stale", since: Date.now(), error: null };

  return {
    current: () => value,
    stale: (error) => {
      if (value.kind === "stale" && value.error === error) return false;
      value = { kind: "stale", since: value.kind === "stale" ? value.since : Date.now(), error };

      return true;
    },
    fresh: (seq) => {
      if (value.kind === "fresh" && value.seq === seq) return false;
      value = { kind: "fresh", seq };

      return true;
    },
  };
}

export function readRetries(): Retries {
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    failed: (run) => {
      failures += 1;
      clearTimeout(timer);
      timer = setTimeout(run, retryDelay(failures));
    },
    reset: () => {
      failures = 0;
      clearTimeout(timer);
    },
  };
}

export type Join = (scope: string, attachment: Attachment) => Disposer;

export async function request<N extends CallName>(
  socket: HostSocket,
  name: N,
  input: OperationInput<N>,
): Promise<OperationOutput<N>> {
  return decodeOutput(name, await socket.call(name, encodeInput(name, input)));
}

export function keepRows<Row>(
  source: ReadonlyMap<string, Row>,
  previous: ReadonlyMap<string, Row> | undefined,
): ReadonlyMap<string, Row> {
  if (previous === undefined) return new Map(source);
  let rows: Map<string, Row> | null = null;
  let unchanged = 0;

  for (const entry of source) {
    const held = previous.get(entry[0]);

    const kept =
      held !== undefined && (held === entry[1] || sameJson(held, entry[1])) ? held : entry[1];

    if (rows === null && kept === held) {
      unchanged += 1;
      continue;
    }

    rows ??= heldRows(source, previous, unchanged);
    rows.set(entry[0], kept);
  }

  if (rows !== null) return rows;

  return source.size === previous.size ? previous : heldRows(source, previous, source.size);
}

function heldRows<Row>(
  source: ReadonlyMap<string, Row>,
  previous: ReadonlyMap<string, Row>,
  count: number,
): Map<string, Row> {
  const rows = new Map<string, Row>();

  for (const entry of source) {
    if (rows.size === count) break;
    rows.set(entry[0], previous.get(entry[0]) ?? entry[1]);
  }

  return rows;
}

export function sameJson<T>(left: T, right: T): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export interface Listeners {
  readonly subscribe: (listener: () => void) => Disposer;
  readonly notify: () => void;
  readonly size: () => number;
  readonly clear: () => void;
}

export function listenerSet(): Listeners {
  const listeners = new Map<() => void, number>();
  let changes = 0;
  let queued = false;

  const flush = (): void => {
    queued = false;

    for (const [listener, since] of listeners) {
      if (since === changes) continue;

      queueMicrotask(() => {
        if (listeners.get(listener) === since) listener();
      });
    }
  };

  return {
    subscribe: (listener) => {
      listeners.set(listener, changes);

      return () => {
        listeners.delete(listener);
      };
    },
    notify: () => {
      changes += 1;

      if (queued) return;
      queued = true;
      queueMicrotask(flush);
    },
    size: () => listeners.size,
    clear: () => listeners.clear(),
  };
}
