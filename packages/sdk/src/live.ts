import type { Disposer } from "@nyte-ai/schema";
import { decodeOutput, encodeInput } from "@nyte-ai/protocol";
import type { CallName, HostSocket, OperationInput, OperationOutput } from "@nyte-ai/protocol";

export interface Live<T> {
  subscribe(listener: () => void): Disposer;
  snapshot(): T;
}

export type Freshness =
  | { readonly kind: "fresh"; readonly seq: number }
  | { readonly kind: "stale"; readonly since: number };

export interface Attachment {
  attach(socket: HostSocket, subscribed: Promise<void>): void;
  detach(): void;
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
