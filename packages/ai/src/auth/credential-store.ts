/**
 * Default in-memory `CredentialStore`. Apps inject persistent stores (Nyte's
 * `FileCredentialStore` in store.ts); this one backs tests and ephemeral
 * hosts. Writes are serialized per provider through a promise chain and
 * queued work can be cancelled before it runs.
 */
import { operationSignal, raceWithAbortSignal } from "../utils/abort.ts";
import type {
  AuthOperationOptions,
  CredentialAccounts,
  CredentialInfo,
  CredentialStore,
} from "./types.ts";

/**
 * Default in-memory credential store. Apps inject persistent stores.
 * Keyed by `Provider.id`, with accounts and selection stored together.
 * Writes are serialized per provider through a promise chain.
 */
export class InMemoryCredentialStore implements CredentialStore {
  private credentials = new Map<string, CredentialAccounts>();
  private chains = new Map<string, Promise<unknown>>();

  /** Serialize tasks per provider id without releasing the chain before active work settles. */
  private enqueue<T>(
    providerId: string,
    task: () => Promise<T>,
    options?: AuthOperationOptions,
  ): Promise<T> {
    const signal = operationSignal(options?.signal);
    const previous = this.chains.get(providerId) ?? Promise.resolve();

    const queued = (async () => {
      await previous.catch(() => {});
      signal.throwIfAborted();

      return task();
    })();

    const tail = queued.catch(() => {});
    this.chains.set(providerId, tail);
    void tail.then(() => {
      if (this.chains.get(providerId) === tail) this.chains.delete(providerId);
    });

    return raceWithAbortSignal(queued, signal);
  }

  async read(
    providerId: string,
    options?: AuthOperationOptions,
  ): Promise<CredentialAccounts | undefined> {
    options?.signal?.throwIfAborted();

    return this.credentials.get(providerId);
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();

    return [...this.credentials].flatMap(([providerId, stored]) =>
      stored.accounts.map((account) => ({
        providerId,
        id: account.id,
        label: account.label,
        type: account.credential.type,
        active: stored.active === account.id,
      })),
    );
  }

  modify(
    providerId: string,
    fn: (current: CredentialAccounts | undefined) => Promise<CredentialAccounts | undefined>,
    options?: AuthOperationOptions,
  ): Promise<CredentialAccounts | undefined> {
    return this.enqueue(
      providerId,
      async () => {
        const current = this.credentials.get(providerId);
        const next = await fn(current);

        // A rotated token has no second copy, so `CredentialStore` stores it even after abort.
        if (next !== undefined) {
          if (next.accounts.length === 0) this.credentials.delete(providerId);
          else this.credentials.set(providerId, next);
        }

        return next ?? current;
      },
      options,
    );
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.enqueue(
      providerId,
      async () => {
        this.credentials.delete(providerId);
      },
      options,
    );
  }
}
