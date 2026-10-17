/**
 * Per-provider catalog refreshes for `Models`: each run supersedes the provider's previous one,
 * publications apply in order and only for the current run, and the cached catalog is restored
 * before credentials are resolved or the network is used.
 */
import { keyedSerial } from "@nyte-ai/schema/serial";
import { ModelsError } from "./auth/resolve.ts";
import type { Credential, CredentialAccounts } from "./auth/types.ts";
import type { ModelsStore } from "./models-store.ts";
import type { ModelsPublication, Provider, RefreshModelsContext } from "./models-types.ts";
import { raceWithAbortSignal } from "./utils/abort.ts";

export class CatalogRefreshes {
  private generations = new Map<string, number>();
  private controllers = new Map<string, AbortController>();
  /** Settles once the running refresh for a provider has restored its cached catalog. */
  private restorations = new Map<string, Promise<void>>();
  private readonly publications = keyedSerial<string>();
  private readonly modelsStore: ModelsStore;
  private readonly catalog: RefreshModelsContext["catalog"];

  constructor(modelsStore: ModelsStore, catalog: RefreshModelsContext["catalog"]) {
    this.modelsStore = modelsStore;
    this.catalog = catalog;
  }

  /** Cancels the provider's running refresh, so a replaced or removed provider never publishes. */
  supersede(providerId: string): number {
    const generation = (this.generations.get(providerId) ?? 0) + 1;
    this.generations.set(providerId, generation);
    const previous = this.controllers.get(providerId);

    if (previous) {
      this.controllers.delete(providerId);
      previous.abort();
    }

    return generation;
  }

  /** Providers with a refresh in flight. */
  running(): Iterable<string> {
    return this.controllers.keys();
  }

  private publish(
    providerId: string,
    generation: number,
    signal: AbortSignal,
    publication: ModelsPublication,
  ): Promise<boolean> {
    const queued = this.publications.run(providerId, async () => {
      if (signal.aborted || this.generations.get(providerId) !== generation) return false;

      if (publication.persist === null) {
        await this.modelsStore.delete(providerId, { signal });
      } else if (publication.persist !== undefined) {
        await this.modelsStore.write(providerId, structuredClone(publication.persist), { signal });
      }

      if (signal.aborted || this.generations.get(providerId) !== generation) return false;
      publication.update?.();

      return true;
    });

    return raceWithAbortSignal(queued, signal);
  }

  private async runPhase(
    provider: Provider,
    credential: Credential | undefined,
    allowNetwork: boolean,
    force: boolean | undefined,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    const stored = await this.modelsStore.read(provider.id, { signal });
    await provider.refreshModels?.({
      credential,
      stored: stored ? structuredClone(stored) : undefined,
      publish: (publication) => this.publish(provider.id, generation, signal, publication),
      allowNetwork,
      force: allowNetwork ? force : undefined,
      catalog: this.catalog,
      signal,
    });
  }

  /**
   * Refreshes one provider and returns its failure, if any; a superseded or cancelled run fails
   * silently. The cached catalog is restored from the stored active account's credential first.
   * An offline refresh only restores the cache, which a running refresh restores first, so it
   * waits for that one instead of superseding it: superseding would cancel its network phase,
   * and nothing would retry that until the next launch.
   */
  async run(
    provider: Provider,
    allowNetwork: boolean,
    force: boolean | undefined,
    callerSignal: AbortSignal,
    readAccounts: (signal: AbortSignal) => Promise<CredentialAccounts | undefined>,
    resolveCredential: (
      accounts: CredentialAccounts | undefined,
      signal: AbortSignal,
    ) => Promise<Credential | undefined>,
  ): Promise<Error | undefined> {
    const running = this.restorations.get(provider.id);

    if (!allowNetwork && running !== undefined) {
      await raceWithAbortSignal(running, callerSignal).catch(() => undefined);

      return undefined;
    }

    const generation = this.supersede(provider.id);
    const controller = new AbortController();
    this.controllers.set(provider.id, controller);
    const signal = AbortSignal.any([callerSignal, controller.signal]);
    const restored = Promise.withResolvers<void>();
    this.restorations.set(provider.id, restored.promise);

    const operation = (async () => {
      let storedAccounts: CredentialAccounts | undefined;
      let credentialError: unknown;

      try {
        storedAccounts = allowNetwork ? await readAccounts(signal) : undefined;
      } catch (error) {
        credentialError = error;
      }

      await this.runPhase(
        provider,
        storedAccounts?.accounts.find((account) => account.id === storedAccounts.active)
          ?.credential,
        false,
        undefined,
        generation,
        signal,
      );

      restored.resolve();

      if (credentialError !== undefined) throw credentialError;

      if (!allowNetwork || signal.aborted) return;

      const credential = await resolveCredential(storedAccounts, signal);

      await this.runPhase(provider, credential, true, force, generation, signal);
    })();

    try {
      await raceWithAbortSignal(operation, signal);

      return undefined;
    } catch (error) {
      if (signal.aborted) return undefined;

      return error instanceof Error
        ? error
        : new ModelsError("model_source", `Model refresh failed for ${provider.id}`, {
            cause: error,
          });
    } finally {
      restored.resolve();

      if (this.controllers.get(provider.id) === controller) this.controllers.delete(provider.id);

      if (this.restorations.get(provider.id) === restored.promise) {
        this.restorations.delete(provider.id);
      }
    }
  }
}
