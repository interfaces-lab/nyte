import type { AccountLimits, AccountLimitsResult } from "./types.ts";
import { operationSignal, raceWithAbortSignal } from "./utils/abort.ts";

const FRESHNESS_MS = 60_000;
const RETRY_MS = 15_000;
const TIMEOUT_MS = 15_000;

type Unavailable = Extract<AccountLimitsResult, { readonly kind: "unavailable" }>;

interface Entry {
  limits: AccountLimits | undefined;
  revision: number;
  readonly observed: Map<string, { readonly at: number; readonly revision: number }>;
  fetchedAt: number | null;
  retryAt: number;
  error: string | null;
  unavailable: Unavailable | null;
  flight: { readonly result: Promise<AccountLimitsResult>; readonly abort: AbortController } | null;
}

interface ProviderCache {
  generation: number;
  lastAccount: string | null;
  readonly accounts: Map<string | null, Entry>;
}

/** A request's account observations cannot outlive the credential selection it started with. */
interface AccountLimitsScope {
  observe(accountId: string | undefined, limits: AccountLimits): void;
  fetch(
    accountId: string | undefined,
    load: (signal: AbortSignal) => Promise<AccountLimits | undefined>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AccountLimitsResult>;
}

function mergeLimits(entry: Entry, next: AccountLimits, requestRevision = entry.revision): void {
  const previous = entry.limits;
  const windows = new Map(previous?.windows.map((window) => [window.id, window]));
  entry.revision += 1;

  for (const window of next.windows) {
    const observed = entry.observed.get(window.id);

    if (
      observed !== undefined &&
      (observed.at > next.observedAt || observed.revision > requestRevision)
    )
      continue;

    windows.set(window.id, window);
    entry.observed.set(window.id, { at: next.observedAt, revision: entry.revision });
  }

  entry.limits = {
    ...previous,
    ...next,
    windows: [...windows.values()],
    observedAt: Math.max(previous?.observedAt ?? 0, next.observedAt),
  };
}

function snapshot(entry: Entry): AccountLimitsResult {
  if (entry.limits === undefined)
    return (
      entry.unavailable ?? { kind: "unavailable", reason: "failed", message: "No usage available." }
    );

  return {
    kind: "ready",
    limits: entry.limits,
    stale: entry.fetchedAt === null || Date.now() - entry.fetchedAt >= FRESHNESS_MS,
    error: entry.error,
  };
}

function changedAccount(): Unavailable {
  return { kind: "unavailable", reason: "failed", message: "The active account changed." };
}

/** Owns account quota freshness, shared requests, and credential lifecycle invalidation. */
export class AccountLimitsCache {
  private readonly providers = new Map<string, ProviderCache>();

  get(providerId: string, accountId?: string | null): AccountLimits | undefined {
    const provider = this.providers.get(providerId);

    return provider?.accounts.get(accountId === undefined ? provider.lastAccount : accountId)
      ?.limits;
  }

  invalidate(providerId: string): void {
    const provider = this.providers.get(providerId);

    if (provider === undefined) return;
    provider.generation += 1;

    for (const entry of provider.accounts.values()) entry.flight?.abort.abort();

    provider.accounts.clear();
  }

  scope(providerId: string): AccountLimitsScope {
    let provider = this.providers.get(providerId);

    if (provider === undefined) {
      provider = { generation: 0, lastAccount: null, accounts: new Map() };
      this.providers.set(providerId, provider);
    }

    const state = provider;
    const generation = state.generation;

    const accountEntry = (accountId: string | undefined): Entry => {
      const key = accountId ?? null;
      state.lastAccount = key;
      const existing = state.accounts.get(key);

      if (existing !== undefined) return existing;

      const entry: Entry = {
        limits: undefined,
        revision: 0,
        observed: new Map(),
        fetchedAt: null,
        retryAt: 0,
        error: null,
        unavailable: null,
        flight: null,
      };
      state.accounts.set(key, entry);

      return entry;
    };

    return {
      observe(accountId, limits) {
        if (state.generation !== generation) return;
        const entry = accountEntry(accountId);
        mergeLimits(entry, limits);
      },
      async fetch(accountId, load, options) {
        options?.signal?.throwIfAborted();

        if (state.generation !== generation) return changedAccount();
        const entry = accountEntry(accountId);

        if (entry.flight !== null)
          return raceWithAbortSignal(entry.flight.result, operationSignal(options?.signal));

        if (Date.now() < entry.retryAt) return snapshot(entry);

        const abort = new AbortController();
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(TIMEOUT_MS)]);
        const requestRevision = entry.revision;

        const result = (async (): Promise<AccountLimitsResult> => {
          try {
            const limits = await raceWithAbortSignal(
              Promise.resolve().then(() => load(signal)),
              signal,
            );

            if (state.generation !== generation) return changedAccount();

            if (limits === undefined) {
              entry.unavailable = {
                kind: "unavailable",
                reason: "unsupported",
                message: "This account does not provide subscription usage.",
              };
              entry.retryAt = Date.now() + RETRY_MS;

              return snapshot(entry);
            }

            mergeLimits(entry, limits, requestRevision);
            entry.fetchedAt = Date.now();
            entry.retryAt = entry.fetchedAt + FRESHNESS_MS;
            entry.error = null;
            entry.unavailable = null;

            return snapshot(entry);
          } catch (error) {
            if (state.generation !== generation) return changedAccount();
            const message = error instanceof Error ? error.message : String(error);
            entry.error = message;
            entry.unavailable = { kind: "unavailable", reason: "failed", message };
            entry.retryAt = Date.now() + RETRY_MS;

            return snapshot(entry);
          } finally {
            entry.flight = null;
          }
        })();

        entry.flight = { result, abort };

        return raceWithAbortSignal(result, operationSignal(options?.signal));
      },
    };
  }
}
