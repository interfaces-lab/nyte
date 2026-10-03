import {
  parseStoredConnection,
  serializeConnection,
  type ManagedPolicy,
  type SavedConnection,
} from "./connection.ts";

/** Where the one saved connection lives: the Keychain in the app, memory in tests. */
export interface ConnectionStorage {
  readonly read: () => Promise<string | null>;
  readonly write: (text: string) => Promise<void>;
  readonly remove: () => Promise<void>;
}

export type ConnectionSnapshot =
  | { readonly kind: "loading" }
  | { readonly kind: "none" }
  /**
   * What the Keychain holds is not known: it held something this build cannot
   * read, refused the read, or kept a cancelled write that could not be undone.
   * Nothing is served from it.
   */
  | { readonly kind: "unknown" }
  | { readonly kind: "saved"; readonly saved: SavedConnection };

export type SaveResult =
  /** `replaced` is the connection this one took the place of, whose bearer the caller may release. */
  | { readonly kind: "saved"; readonly replaced: SavedConnection | undefined }
  /** Nothing changed on disk: the abort came first, or the write was undone. */
  | { readonly kind: "cancelled" }
  /** The write failed, or a cancelled write could not be undone. `next` may still be on disk. */
  | { readonly kind: "failed" };

export interface ConnectionStore {
  readonly getSnapshot: () => ConnectionSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly load: () => Promise<void>;
  /**
   * Replace the saved connection unless `signal` aborts first. An abort that
   * lands during the write puts the previous connection back. When that undo
   * fails too, the store serves nothing and reports `failed`, never
   * `cancelled`, so no caller promises a rollback that did not happen.
   */
  readonly save: (next: SavedConnection, signal: AbortSignal) => Promise<SaveResult>;
  /**
   * Remove the saved connection when `match` accepts it, after `release` has
   * run. Resolves to what was removed, or undefined when nothing matched.
   */
  readonly remove: <S extends SavedConnection, T>(input: {
    readonly match: (saved: SavedConnection) => saved is S;
    readonly release: (saved: S) => Promise<T>;
  }) => Promise<{ readonly saved: S; readonly released: T } | undefined>;
}

/**
 * The saved connection as an external store. Every change runs in one queue,
 * so a write that started earlier cannot land after a removal that started
 * later. The bearer stays here and in the Keychain, never in a query cache.
 */
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

  // Every queued change reads the Keychain first, whoever asked first.
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
            // At least try not to keep the cancelled bearer, then admit the disk is unknown.
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
