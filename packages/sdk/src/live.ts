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

export type FreshnessCell = {
  readonly current: () => Freshness;
  readonly stale: (error: SdkError | null) => boolean;
  readonly fresh: (seq: number) => boolean;
};

export type Retries = {
  readonly failed: (run: () => void) => void;
  readonly reset: () => void;
};

const RETRY_BASE_MS = 1_000;

const RETRY_MAX_MS = 30_000;

export function retryDelay(attempt: number): number {
  const ceiling = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);

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
  const rows = new Map<string, Row>();
  let changed = source.size !== previous.size;

  source.forEach((row, key) => {
    const held = previous.get(key);
    const kept = held !== undefined && (held === row || sameJson(held, row)) ? held : row;

    if (kept !== held) changed = true;
    rows.set(key, kept);
  });

  return changed ? rows : previous;
}

export function sameJson<T>(left: T, right: T): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export type Listeners = {
  readonly subscribe: (listener: () => void) => Disposer;
  readonly notify: () => void;
  readonly clear: () => void;
};

export function listenerSet(): Listeners {
  const listeners = new Set<() => void>();

  return {
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    notify: () => {
      for (const listener of listeners) listener();
    },
    clear: () => listeners.clear(),
  };
}
