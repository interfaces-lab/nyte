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

/** The first host revision whose `head.read` and `sessions.read` take `resume.held`. An older host refuses the field as unknown. */
const HELD_REVISION = 27;

const RETRY_BASE_MS = 1_000;

const RETRY_MAX_MS = 30_000;

/**
 * Paces the socket's redials, and the reads a store retries on an open socket: 1 s doubling to 30 s, each step a random point in its upper half. A redial is a hello, a welcome and a resume of every scope the client holds, so it starts at 1 s rather than at once; it is jittered because a host that restarts drops every client's socket in the same instant, and they should not all come back in the same one. A welcome resets it, and `retry()` skips the wait. The HTTP link paces its requests with `httpRetryDelay` in `connection/rows.ts`.
 */
export function socketRetryDelay(attempt: number): number {
  const ceiling = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);

  return ceiling / 2 + (Math.random() * ceiling) / 2;
}

/** Whether the socket's host takes `resume.held`, from the revision its welcome names. A resume that would send `held` waits for the welcome, a round trip it otherwise shares with the hello. */
export async function takesHeld(socket: HostSocket): Promise<boolean> {
  return (await socket.welcome).api_server_revision >= HELD_REVISION;
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
      timer = setTimeout(run, socketRetryDelay(failures));
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
