import {
  parseStoredConnection,
  serializeConnection,
  type ManagedPolicy,
  type SavedConnection,
} from "./connection.ts";

export interface ConnectionStorage {
  readonly read: () => Promise<string | null>;
  readonly write: (text: string) => Promise<void>;
  readonly remove: () => Promise<void>;
}

type ConnectionSnapshot =
  | { readonly kind: "loading" }
  | { readonly kind: "none" }
  | { readonly kind: "unknown" }
  | { readonly kind: "saved"; readonly saved: SavedConnection };

export type SaveResult =
  | { readonly kind: "saved"; readonly replaced: SavedConnection | undefined }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed" };

export interface ConnectionStore {
  readonly getSnapshot: () => ConnectionSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly load: () => Promise<void>;
  readonly save: (next: SavedConnection, signal: AbortSignal) => Promise<SaveResult>;
  readonly remove: <S extends SavedConnection, T>(input: {
    readonly match: (saved: SavedConnection) => saved is S;
    readonly release: (saved: S) => Promise<T>;
  }) => Promise<{ readonly saved: S; readonly released: T } | undefined>;
}

export function createConnectionStore(
  storage: ConnectionStorage,
  policy: ManagedPolicy | undefined,
): ConnectionStore {
  let snapshot: ConnectionSnapshot = { kind: "loading" };
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();

  const publish = (next: ConnectionSnapshot) => {
    snapshot = next;

    for (const listener of listeners) listener();
  };

  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);

    return run;
  };

  const settle = async () => {
    if (snapshot.kind !== "loading") return;

    try {
      const text = await storage.read();
      publish(
        text === null
          ? { kind: "none" }
          : { kind: "saved", saved: parseStoredConnection(text, policy) },
      );
    } catch {
      publish({ kind: "unknown" });
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    load: () => exclusive(settle),
    save: (next, signal) =>
      exclusive(async () => {
        await settle();

        if (signal.aborted) return { kind: "cancelled" };
        const previous = snapshot;

        try {
          await storage.write(serializeConnection(next));
        } catch {
          return { kind: "failed" };
        }

        if (signal.aborted) {
          try {
            await (previous.kind === "saved"
              ? storage.write(serializeConnection(previous.saved))
              : storage.remove());

            return { kind: "cancelled" };
          } catch {
            await storage.remove().catch(() => undefined);
            publish({ kind: "unknown" });

            return { kind: "failed" };
          }
        }

        publish({ kind: "saved", saved: next });

        return { kind: "saved", replaced: previous.kind === "saved" ? previous.saved : undefined };
      }),
    remove: ({ match, release }) =>
      exclusive(async () => {
        await settle();

        if (snapshot.kind !== "saved" || !match(snapshot.saved)) return undefined;
        const { saved } = snapshot;
        const released = await release(saved);
        await storage.remove();
        publish({ kind: "none" });

        return { saved, released };
      }),
  };
}
