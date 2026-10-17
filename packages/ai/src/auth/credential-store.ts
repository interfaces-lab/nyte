/**
 * Default in-memory `CredentialStore`. Apps inject persistent stores (Nyte's
 * `FileCredentialStore` in store.ts); this one backs tests and ephemeral
 * hosts. Writes run one at a time per provider, and queued work can be
 * cancelled before it runs.
 */
import { keyedSerial } from "@nyte-ai/schema/serial";
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
 * Writes run one at a time per provider.
 */
export class InMemoryCredentialStore implements CredentialStore {
  private credentials = new Map<string, CredentialAccounts>();
  private readonly writes = keyedSerial<string>();

  /** Runs `task` after the provider's earlier writes; a cancelled caller stops waiting, and a task cancelled before it starts never runs. */
  private enqueue<T>(
    providerId: string,
    task: () => Promise<T>,
    options?: AuthOperationOptions,
  ): Promise<T> {
    const signal = operationSignal(options?.signal);

    const queued = this.writes.run(providerId, () => {
      signal.throwIfAborted();

      return task();
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

  /** Stores what `fn` returns even after abort: a rotated token has no second copy. */
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
