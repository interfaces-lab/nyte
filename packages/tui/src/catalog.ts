/**
 * The terminal client's provider catalog: explicit provider factories over
 * the `~/.nyte` credential and model stores, so a login made here is a login
 * in every Nyte client.
 */
import { defaultModelPerProvider } from "@nyte-ai/ai";
import type {
  Api,
  AuthCheck,
  AuthOperationOptions,
  Model,
  Models,
  ModelsRefreshOptions,
  Provider,
} from "@nyte-ai/ai";
import type { ThinkingLevel } from "@nyte-ai/core";

export const DEFAULT_PROVIDER_ID = "openai-codex";
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";

/**
 * Restore the provider's persisted catalog on top of its baked models. Local
 * disk only: the boot path must work on a plane.
 */
export async function loadProviderCatalog(models: Models, providerId: string): Promise<void> {
  await models.refresh({ providers: [providerId], allowNetwork: false });
}

export type ProviderAuthStatus =
  | { readonly kind: "authenticated"; readonly provider: Provider; readonly auth: AuthCheck }
  | { readonly kind: "unauthenticated"; readonly provider: Provider };

/** Resolve provider status concurrently so pickers can mark logged-in providers. */
export function providerAuthStatuses(
  models: Models,
  options?: AuthOperationOptions,
): Promise<ProviderAuthStatus[]> {
  return Promise.all(
    models.getProviders().map(async (provider): Promise<ProviderAuthStatus> => {
      const auth = await models.checkAuth(provider.id, options);
      return auth === undefined
        ? { kind: "unauthenticated", provider }
        : { kind: "authenticated", provider, auth };
    }),
  );
}

async function fetchAuthenticatedModels(
  models: Models,
  options: Pick<ModelsRefreshOptions, "force" | "allowNetwork" | "signal">,
): Promise<readonly Model<Api>[]> {
  const statuses = await providerAuthStatuses(models, { signal: options.signal });
  const providers = statuses.flatMap((status) =>
    status.kind === "authenticated" ? [status.provider] : [],
  );
  await models.refresh({ providers: providers.map((provider) => provider.id), ...options });
  const available = await Promise.all(
    providers.map((provider) => models.getAvailable(provider.id, { signal: options.signal })),
  );
  return available.flat();
}

interface CatalogCache {
  loaded: readonly Model<Api>[] | undefined;
  loading: Promise<readonly Model<Api>[]> | undefined;
}

const catalogCache = new WeakMap<Models, CatalogCache>();

function cacheFor(models: Models): CatalogCache {
  const existing = catalogCache.get(models);
  if (existing !== undefined) return existing;
  const created: CatalogCache = { loaded: undefined, loading: undefined };
  catalogCache.set(models, created);
  return created;
}

/** The last catalog this process loaded, so a menu paints before the network answers. */
export function cachedAuthenticatedModels(models: Models): readonly Model<Api>[] | undefined {
  return cacheFor(models).loaded;
}

/** A completed credential mutation makes both cached and in-flight auth snapshots obsolete. */
export function invalidateAuthenticatedModels(models: Models): void {
  const cache = cacheFor(models);
  cache.loaded = undefined;
  cache.loading = undefined;
}

/** One model catalog across every provider with configured auth. Concurrent callers share a refresh. */
export function loadAuthenticatedModels(
  models: Models,
  options: Pick<ModelsRefreshOptions, "force" | "allowNetwork" | "signal"> = {},
): Promise<readonly Model<Api>[]> {
  const cache = cacheFor(models);
  const pending = cache.loading;
  if (pending !== undefined && options.force !== true) return pending;
  const load = fetchAuthenticatedModels(models, options)
    .then((available) => {
      if (cache.loading === load) cache.loaded = available;
      return available;
    })
    .finally(() => {
      if (cache.loading === load) cache.loading = undefined;
    });
  cache.loading = load;
  return load;
}

export function requireProvider(models: Models, providerId: string): Provider {
  const provider = models.getProvider(providerId);
  if (provider === undefined) throw new Error(`Unknown provider: ${providerId}`);
  return provider;
}

/** Default choice is client policy; model capabilities still come from @nyte-ai/ai. */
export function defaultModel(models: Models, providerId: string): Model<Api> {
  const providerModels = models.getModels(providerId);
  const preferredId = defaultModelPerProvider[providerId];
  const model =
    providerModels.find((candidate) => candidate.id === preferredId) ?? providerModels.at(0);
  if (model === undefined) throw new Error(`${providerId} does not expose any models`);
  return model;
}

export function requireModel(models: Models, providerId: string, modelId?: string): Model<Api> {
  if (modelId === undefined) return defaultModel(models, providerId);
  const model = models.getModel(providerId, modelId);
  if (model === undefined) throw new Error(`Unknown ${providerId} model: ${modelId}`);
  return model;
}
