import { MODEL_THINKING_LEVELS, ModelSchema, normalizeContext } from "@nyte-ai/schema/model";
import { Value } from "typebox/value";
import { lazyStream } from "./api/lazy.ts";
import { AccountLimitsCache } from "./account-limits-cache.ts";
import { defaultProviderAuthContext as defaultAuthContext } from "./auth/context.ts";
import { InMemoryCredentialStore } from "./auth/credential-store.ts";
import {
  type AuthResolutionOverrides,
  DEFAULT_OAUTH_REFRESH_TIMEOUT_MS,
  ModelsError,
  resolveProviderAuth,
} from "./auth/resolve.ts";
import type {
  AuthCheck,
  AuthContext,
  AuthInteraction,
  AuthOperationOptions,
  AuthResult,
  AuthType,
  AuthVerification,
  Credential,
  CredentialAccounts,
  CredentialInfo,
  CredentialStore,
  ModelAuth,
  ProviderAuth,
} from "./auth/types.ts";
import { InMemoryModelsStore, type ModelsStore, type ModelsStoreEntry } from "./models-store.ts";
import { baseModel, providerRequest, withFastVariants } from "./model-variants.ts";
import type {
  AccountLimits,
  AccountLimitsResult,
  Api,
  ApiStreamOptions,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  DeferredCancelOptions,
  DeferredFetchOptions,
  DeferredHandle,
  FetchFunction,
  Model,
  ModelCostRates,
  ModelThinkingLevel,
  PromptCachePolicy,
  ProviderHeaders,
  ProviderRequestOptions,
  ProviderStreams,
  SimpleStreamOptions,
  TranscriptContext,
  Usage,
} from "./types.ts";
import { operationSignal, raceWithAbortSignal } from "./utils/abort.ts";
import { mergeProviderHeaders } from "./utils/headers.ts";
import { uuidv7 } from "./utils/uuid.ts";

export { ModelsError, type ModelsErrorCode } from "./auth/resolve.ts";

export interface ModelsPublication {
  /** Provider-selected persisted catalog. Omit to leave storage unchanged; null deletes it. */
  persist?: ModelsStoreEntry | null;
  /** Optional synchronous update of provider-private in-memory catalog state. */
  update?: () => void;
}

export interface RefreshModelsContext {
  /** Effective configured credential. OAuth credentials are refreshed before network access. */
  credential?: Credential;
  /** Immutable provider-scoped catalog snapshot captured before this refresh phase. */
  stored?: Readonly<ModelsStoreEntry>;
  /**
   * Generation-checked publication. Persistence policy remains provider-owned;
   * the update runs synchronously only after the selected persistence mutation.
   */
  publish(publication: ModelsPublication): Promise<boolean>;
  /** False during offline/cache-only initialization. */
  allowNetwork: boolean;
  /** Bypass provider freshness checks and fetch immediately when network access is allowed. */
  force?: boolean;
  /** Hosted catalog transport shared by every provider in this collection. */
  catalog: {
    url: string;
    fetch: FetchFunction;
  };
  /** Always present, including when the public refresh caller omits its optional signal. */
  signal: AbortSignal;
}

export interface ModelsRefreshOptions {
  allowNetwork?: boolean;
  /** Restrict refresh to these provider IDs. Unknown and static providers are ignored. */
  providers?: readonly string[];
  /** Bypass provider freshness checks and fetch immediately when network access is allowed. */
  force?: boolean;
  signal?: AbortSignal;
}

export interface ModelsRefreshResult {
  aborted: boolean;
  errors: ReadonlyMap<string, Error>;
}

export interface ModelsRequestTransforms {
  /** Transform fully assembled model/auth/request headers before provider dispatch. */
  transformHeaders?: (headers: ProviderHeaders) => ProviderHeaders | Promise<ProviderHeaders>;
}

export type ModelsApiStreamOptions<TApi extends Api> = ApiStreamOptions<TApi> &
  ModelsRequestTransforms;

export type ModelsSimpleStreamOptions = SimpleStreamOptions & ModelsRequestTransforms;

export type ModelsDeferredFetchOptions = DeferredFetchOptions & ModelsRequestTransforms;

export type ModelsDeferredCancelOptions = DeferredCancelOptions & ModelsRequestTransforms;

/**
 * A provider is the concrete runtime unit. It owns id/name/base metadata,
 * auth methods, model listing, and stream behavior.
 *
 * `TApi` lets concrete provider factories declare which APIs their models
 * use (e.g. `openaiProvider(): Provider<"openai-responses" | "openai-completions">`),
 * giving typed model lists to direct factory users. Inside a `Models`
 * collection providers are held as `Provider<Api>`.
 */
export interface Provider<TApi extends Api = Api> {
  readonly id: string;
  readonly name: string;

  readonly baseUrl?: string;
  readonly headers?: ProviderHeaders;
  /** Prompt-cache behavior published for hosts that present cache state. */
  readonly promptCache?: PromptCachePolicy;

  /**
   * Required: at least one of `apiKey`/`oauth`. Every provider has auth
   * semantics — even providers with only ambient credentials (env vars, AWS
   * profiles, ADC files) and keyless local servers provide `apiKey` auth
   * whose `resolve()` reports whether the provider is configured.
   * `Models.getAuth()` returns undefined when the provider is unconfigured.
   */
  readonly auth: ProviderAuth;

  /** Fetch subscription windows without generating model output. */
  fetchAccountLimits?(input: {
    readonly auth: ModelAuth;
    readonly credential?: Credential;
    readonly signal: AbortSignal;
  }): Promise<AccountLimits | undefined>;

  /**
   * Current catalog, sync. Returns the list restored by the last `refreshModels()`
   * call or fetched from the hosted feed. Empty before either succeeds. Must not
   * throw; `Models` treats a throwing implementation as having no models.
   */
  getModels(): readonly Model<TApi>[];

  /**
   * Restore `context.stored` and optionally fetch a newer catalog. Implementations retain their
   * previous list on failure, publish persistence and synchronous state changes through
   * `context.publish()`, and honor the shared abort signal for blocking work.
   */
  refreshModels?(context: RefreshModelsContext): Promise<void>;

  /**
   * Optional provider policy for credential-specific model availability.
   * `getModels()` remains the complete synchronous catalog; `Models.getAvailable()`
   * applies this filter after confirming that provider auth is configured.
   */
  filterModels?(
    models: readonly Model<TApi>[],
    credential: Credential | undefined,
  ): readonly Model<TApi>[];

  /** Stream a normalized transcript. `Models` normalizes the caller's `Context` before dispatching here. */
  stream<T extends TApi>(
    model: Model<T>,
    context: TranscriptContext,
    options?: ApiStreamOptions<T>,
  ): AssistantMessageEventStream;

  streamSimple(
    model: Model<TApi>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
  fetchDeferred?(
    model: Model<TApi>,
    handle: DeferredHandle,
    options?: DeferredFetchOptions,
  ): AssistantMessageEventStream;
  cancelDeferred?(
    model: Model<TApi>,
    handle: DeferredHandle,
    options?: DeferredCancelOptions,
  ): Promise<void>;
}

/**
 * Runtime collection of providers plus auth application and stream
 * convenience. Providers own stream behavior; `Models` resolves auth and
 * delegates each request to the provider that owns the model.
 */
export interface Models {
  getProviders(): readonly Provider[];
  getProvider(id: string): Provider | undefined;

  /**
   * Sync read of last-known models from one provider or all providers.
   * Best-effort: a provider whose `getModels()` throws yields no models.
   */
  getModels(provider?: string): readonly Model<Api>[];

  /**
   * Sync runtime model lookup against last-known lists. Dynamic model lists
   * are typed as `Model<Api>`; narrow with the `hasApi()` type guard.
   */
  getModel(provider: string, id: string): Model<Api> | undefined;

  /**
   * Refresh selected providers concurrently (all when `providers` is omitted). Provider errors
   * and cancellation are returned without rejecting; static and unknown providers are skipped.
   * With `allowNetwork: false` it restores the cached catalogs without reading any credential.
   */
  refresh(options?: ModelsRefreshOptions): Promise<ModelsRefreshResult>;

  /**
   * Check whether a provider has complete auth configuration without refreshing OAuth. A stored
   * credential answers from `CredentialStore.list()`, so no secret is read unless the provider's
   * `apiKey.check` needs it.
   */
  checkAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthCheck | undefined>;

  /**
   * Resolve provider auth and prove it with the provider's `auth.verify` request.
   * Providers without one report a present credential as unverified. Rejects
   * only on abort or the auth resolution failures `getAuth()` rejects with.
   */
  verifyAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthVerification>;

  /**
   * The account state a provider last reported on one of this collection's
   * requests. Instant and never a network call; undefined until a request has
   * run. Providers report their shared windows on every response, so this is
   * as current as the last turn, though it may omit windows only a usage
   * endpoint lists.
   */
  getAccountLimits(providerId: string, accountId?: string | null): AccountLimits | undefined;

  /** Read cached subscription windows, joining a bounded fetch when they are stale. */
  fetchAccountLimits(
    providerId: string,
    options?: AuthOperationOptions,
  ): Promise<AccountLimitsResult>;

  /** List stored accounts without reading secrets or resolving auth. */
  listAccounts(
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly CredentialInfo[]>;

  /** Select the account used by new requests; already-started requests retain their account. */
  selectAccount(
    providerId: string,
    accountId: string,
    options?: AuthOperationOptions,
  ): Promise<void>;

  /** Return models whose providers have complete auth configuration. */
  getAvailable(providerId?: string, options?: AuthOperationOptions): Promise<readonly Model<Api>[]>;

  /**
   * Resolve provider-scoped auth by provider id, or provider auth plus static
   * model headers when passed a model. Includes a source label for status UI.
   * Resolves `undefined` when the provider is unknown or unconfigured.
   * Rejects with `ModelsError`: code "oauth" when a token refresh fails (the
   * stored credential is preserved for retry; re-login fixes it), code "auth"
   * when api-key resolution or the credential store fails. Request paths
   * surface rejections as stream errors.
   */
  getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
  getAuth(model: Model<Api>, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;

  login(
    providerId: string,
    type: AuthType,
    interaction: AuthInteraction,
    label?: string,
  ): Promise<Credential>;

  /** Remove the active account, keeping other accounts without selecting a replacement. */
  logout(providerId: string, options?: AuthOperationOptions): Promise<void>;

  stream<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): AssistantMessageEventStream;

  complete<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): Promise<AssistantMessage>;

  streamSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): AssistantMessageEventStream;
  completeSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): Promise<AssistantMessage>;
  fetchDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredFetchOptions,
  ): Promise<AssistantMessage>;
  cancelDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredCancelOptions,
  ): Promise<void>;
}

export interface MutableModels extends Models {
  /** An independent provider registry sharing this catalog's credential and model stores. */
  withProvider(provider: Provider): Models;
  /** Upsert/replace by provider.id. Provider ids are unique. */
  setProvider(provider: Provider): void;
  deleteProvider(id: string): void;
  clearProviders(): void;
}

export const DEFAULT_MODELS_CATALOG_URL = "https://pub-426b80ba181f408387bc9361b2fcbe3f.r2.dev";

export interface CreateModelsOptions {
  credentials?: CredentialStore;
  modelsStore?: ModelsStore;
  authContext?: AuthContext;
  catalog?: {
    url?: string;
    fetch?: FetchFunction;
  };
}

class ModelsImpl implements MutableModels {
  private providers = new Map<string, Provider>();
  private credentials: CredentialStore;
  private modelsStore: ModelsStore;
  private authContext: AuthContext;
  private catalog: RefreshModelsContext["catalog"];
  private accountLimits: AccountLimitsCache;
  private activeAccounts: Map<string, string | null>;
  private refreshGenerations = new Map<string, number>();
  private refreshControllers = new Map<string, AbortController>();
  /** Settles once the running refresh for a provider has restored its cached catalog. */
  private restorations = new Map<string, Promise<void>>();
  private publicationChains = new Map<string, Promise<unknown>>();

  constructor(
    options?: CreateModelsOptions,
    accountLimits = new AccountLimitsCache(),
    activeAccounts = new Map<string, string | null>(),
  ) {
    this.credentials = options?.credentials ?? new InMemoryCredentialStore();
    this.modelsStore = options?.modelsStore ?? new InMemoryModelsStore();
    this.authContext = options?.authContext ?? defaultAuthContext();
    this.catalog = {
      url: options?.catalog?.url ?? DEFAULT_MODELS_CATALOG_URL,
      fetch: options?.catalog?.fetch ?? globalThis.fetch,
    };
    this.accountLimits = accountLimits;
    this.activeAccounts = activeAccounts;
  }

  withProvider(provider: Provider): Models {
    const models = new ModelsImpl(
      {
        credentials: this.credentials,
        modelsStore: this.modelsStore,
        authContext: this.authContext,
        catalog: this.catalog,
      },
      this.accountLimits,
      this.activeAccounts,
    );

    for (const entry of this.providers.values()) models.setProvider(entry);
    models.setProvider(provider);

    return models;
  }

  setProvider(provider: Provider): void {
    this.supersedeProviderRefresh(provider.id);
    this.providers.set(provider.id, provider);
  }

  deleteProvider(id: string): void {
    this.supersedeProviderRefresh(id);
    this.providers.delete(id);
  }

  clearProviders(): void {
    for (const id of new Set([...this.providers.keys(), ...this.refreshControllers.keys()])) {
      this.supersedeProviderRefresh(id);
    }

    this.providers.clear();
  }

  getProviders(): readonly Provider[] {
    return Array.from(this.providers.values());
  }

  getProvider(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  getModels(provider?: string): readonly Model<Api>[] {
    if (provider !== undefined) {
      const entry = this.providers.get(provider);

      if (!entry) return [];

      try {
        return withFastVariants(entry.getModels());
      } catch {
        return [];
      }
    }

    const models: Model<Api>[] = [];

    for (const entry of this.providers.values()) {
      try {
        models.push(...withFastVariants(entry.getModels()));
      } catch {
        // Best-effort: ill-behaved providers yield no models.
      }
    }

    return models;
  }

  getModel(provider: string, id: string): Model<Api> | undefined {
    return this.getModels(provider).find((model) => model.id === id);
  }

  private supersedeProviderRefresh(providerId: string): number {
    const generation = (this.refreshGenerations.get(providerId) ?? 0) + 1;
    this.refreshGenerations.set(providerId, generation);
    const previous = this.refreshControllers.get(providerId);

    if (previous) {
      this.refreshControllers.delete(providerId);
      previous.abort();
    }

    return generation;
  }

  private beginProviderRefresh(providerId: string) {
    const generation = this.supersedeProviderRefresh(providerId);
    const controller = new AbortController();
    this.refreshControllers.set(providerId, controller);

    return { generation, controller };
  }

  private publishProviderModels(
    providerId: string,
    generation: number,
    signal: AbortSignal,
    publication: ModelsPublication,
  ): Promise<boolean> {
    const previous = this.publicationChains.get(providerId) ?? Promise.resolve();

    const queued = (async () => {
      await previous.catch(() => {});

      if (signal.aborted || this.refreshGenerations.get(providerId) !== generation) return false;

      if (publication.persist === null) {
        await this.modelsStore.delete(providerId, { signal });
      } else if (publication.persist !== undefined) {
        await this.modelsStore.write(providerId, structuredClone(publication.persist), { signal });
      }

      if (signal.aborted || this.refreshGenerations.get(providerId) !== generation) return false;
      publication.update?.();

      return true;
    })();

    const tail = queued.catch(() => {});
    this.publicationChains.set(providerId, tail);
    void tail.then(() => {
      if (this.publicationChains.get(providerId) === tail)
        this.publicationChains.delete(providerId);
    });

    return raceWithAbortSignal(queued, signal);
  }

  private async runProviderRefreshPhase(
    provider: Provider & Required<Pick<Provider, "refreshModels">>,
    credential: Credential | undefined,
    allowNetwork: boolean,
    force: boolean | undefined,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    const stored = await this.modelsStore.read(provider.id, { signal });
    await provider.refreshModels({
      credential,
      stored: stored ? structuredClone(stored) : undefined,
      publish: (publication) =>
        this.publishProviderModels(provider.id, generation, signal, publication),
      allowNetwork,
      force: allowNetwork ? force : undefined,
      catalog: this.catalog,
      signal,
    });
  }

  async refresh(options: ModelsRefreshOptions = {}): Promise<ModelsRefreshResult> {
    const allowNetwork = options.allowNetwork ?? true;
    const callerSignal = operationSignal(options.signal);
    const errors = new Map<string, Error>();

    if (callerSignal.aborted) return { aborted: true, errors };
    const selected = options.providers ? new Set(options.providers) : undefined;

    const refreshable = Array.from(this.providers.values()).filter(
      (provider): provider is Provider & Required<Pick<Provider, "refreshModels">> =>
        provider.refreshModels !== undefined && (!selected || selected.has(provider.id)),
    );

    const refresh = Promise.all(
      refreshable.map(async (provider) => {
        const running = this.restorations.get(provider.id);

        // An offline refresh only restores the cache, which a running refresh
        // restores first. Superseding it would cancel its network phase, and
        // nothing would retry that until the next launch.
        if (!allowNetwork && running !== undefined) {
          await raceWithAbortSignal(running, callerSignal).catch(() => undefined);

          return;
        }

        const { generation, controller } = this.beginProviderRefresh(provider.id);
        const signal = AbortSignal.any([callerSignal, controller.signal]);
        const restored = Promise.withResolvers<void>();
        this.restorations.set(provider.id, restored.promise);

        const operation = (async () => {
          let storedAccounts: CredentialAccounts | undefined;
          let credentialError: unknown;

          try {
            storedAccounts = allowNetwork
              ? await this.readAccounts(provider.id, signal)
              : undefined;
          } catch (error) {
            credentialError = error;
          }

          // Restore cached provider state before auth resolution or network access.
          await this.runProviderRefreshPhase(
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

          const credential = await this.resolveRefreshCredential(provider, storedAccounts, signal);

          await this.runProviderRefreshPhase(
            provider,
            credential,
            true,
            options.force,
            generation,
            signal,
          );
        })();

        try {
          await raceWithAbortSignal(operation, signal);
        } catch (error) {
          if (!signal.aborted) {
            errors.set(
              provider.id,
              error instanceof Error
                ? error
                : new ModelsError("model_source", `Model refresh failed for ${provider.id}`, {
                    cause: error,
                  }),
            );
          }
        } finally {
          restored.resolve();

          if (this.refreshControllers.get(provider.id) === controller) {
            this.refreshControllers.delete(provider.id);
          }

          if (this.restorations.get(provider.id) === restored.promise) {
            this.restorations.delete(provider.id);
          }
        }
      }),
    );

    try {
      await raceWithAbortSignal(refresh, callerSignal);
    } catch (error) {
      if (!callerSignal.aborted) throw error;
    }

    return { aborted: callerSignal.aborted, errors: new Map(errors) };
  }

  private async resolveRefreshCredential(
    provider: Provider,
    stored: CredentialAccounts | undefined,
    signal: AbortSignal,
  ): Promise<Credential | undefined> {
    const account = stored?.accounts.find((entry) => entry.id === stored.active);

    if (stored && !account) return undefined;
    const credential = account?.credential;

    if (credential?.type === "oauth") {
      const oauth = provider.auth.oauth;

      if (!oauth) return undefined;

      if (Date.now() < credential.expires) return credential;

      if (signal.aborted) return undefined;

      let refreshed: { readonly token: string; readonly credential: Credential } | undefined;
      const post = await this.credentials.modify(
        provider.id,
        async (current) => {
          const selected = current?.accounts.find((entry) => entry.id === account?.id);

          if (!current || selected?.credential.type !== "oauth") return undefined;
          const previous = selected.credential;

          if (Date.now() < previous.expires) return undefined;

          // Same cap as request-path refresh: this runs while the credential
          // lock is held, so a hung request would block every other client.
          if (refreshed?.token !== previous.refresh) {
            const next = await oauth.refresh(
              previous,
              AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_OAUTH_REFRESH_TIMEOUT_MS)]),
            );
            refreshed = { token: previous.refresh, credential: next };
          }

          const next = refreshed.credential;

          return {
            ...current,
            accounts: current.accounts.map((entry) =>
              entry.id === account?.id ? { ...entry, credential: next } : entry,
            ),
          };
        },
        { signal },
      );

      const updated = post?.accounts.find((entry) => entry.id === account?.id)?.credential;

      return updated?.type === "oauth" ? updated : undefined;
    }

    const apiKey = provider.auth.apiKey;

    if (!apiKey) return undefined;
    const result = await apiKey.resolve({
      ctx: this.authContext,
      credential: credential?.type === "api_key" ? credential : undefined,
      signal,
    });

    if (!result) return undefined;

    return { type: "api_key", key: result.auth.apiKey, env: result.env };
  }

  private async readAccounts(
    providerId: string,
    signal: AbortSignal,
  ): Promise<CredentialAccounts | undefined> {
    try {
      return await this.credentials.read(providerId, { signal });
    } catch (error) {
      throw new ModelsError("auth", `Credential store read failed for ${providerId}`, {
        cause: error,
      });
    }
  }

  private async checkOAuthAuth(
    provider: Provider,
    signal: AbortSignal,
  ): Promise<AuthCheck | undefined> {
    const oauth = provider.auth.oauth;

    if (!oauth) return undefined;
    if (!oauth.check) return { source: "OAuth", type: "oauth" };

    try {
      return await oauth.check({ ctx: this.authContext, signal });
    } catch (error) {
      throw new ModelsError("auth", `OAuth auth check failed for provider ${provider.id}`, {
        cause: error,
      });
    }
  }

  private async checkProviderAuth(
    provider: Provider,
    credential: Credential | undefined,
    signal: AbortSignal,
  ): Promise<AuthCheck | undefined> {
    if (credential?.type === "oauth") return this.checkOAuthAuth(provider, signal);

    const apiKey = provider.auth.apiKey;

    if (!apiKey) return undefined;

    if (apiKey.check) {
      try {
        return await apiKey.check({
          ctx: this.authContext,
          credential: credential?.type === "api_key" ? credential : undefined,
          signal,
        });
      } catch (error) {
        throw new ModelsError("auth", `API key auth check failed for provider ${provider.id}`, {
          cause: error,
        });
      }
    }

    try {
      const resolution = await apiKey.resolve({ ctx: this.authContext, credential, signal });

      return resolution ? { source: resolution.source, type: "api_key" } : undefined;
    } catch (error) {
      throw new ModelsError("auth", `API key auth check failed for provider ${provider.id}`, {
        cause: error,
      });
    }
  }

  getAccountLimits(providerId: string, accountId?: string | null): AccountLimits | undefined {
    return this.accountLimits.get(
      providerId,
      accountId === undefined ? this.activeAccounts.get(providerId) : accountId,
    );
  }

  async fetchAccountLimits(
    providerId: string,
    options?: AuthOperationOptions,
  ): Promise<AccountLimitsResult> {
    const signal = operationSignal(options?.signal);
    signal.throwIfAborted();
    const provider = this.providers.get(providerId);
    const scope = this.accountLimits.scope(providerId);
    const fetchLimits = provider?.fetchAccountLimits;

    if (!fetchLimits)
      return scope.fetch(this.activeAccounts.get(providerId) ?? undefined, async () => undefined, {
        signal,
      });

    const accounts = await this.listAccounts(providerId, { signal });
    const account = accounts.find((entry) => entry.active);

    if (
      (accounts.length > 0 && !account) ||
      (!account && (await this.checkAuth(providerId, { signal })) === undefined)
    )
      return {
        kind: "unavailable",
        reason: "unconfigured",
        message: "Sign in to view account usage.",
      };

    return scope.fetch(
      account?.id,
      async (fetchSignal) => {
        const resolution = await this.getAuth(providerId, { signal: fetchSignal });

        if (!resolution || resolution.accountId !== account?.id) {
          this.accountLimits.invalidate(providerId);

          return undefined;
        }

        return fetchLimits({ auth: resolution.auth, signal: fetchSignal });
      },
      { signal },
    );
  }

  async listAccounts(
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly CredentialInfo[]> {
    try {
      const rows = await this.credentials.list(options);
      const selected =
        providerId === undefined ? rows : rows.filter((row) => row.providerId === providerId);
      const providers = providerId === undefined ? this.providers.keys() : [providerId];

      for (const provider of providers)
        this.activeAccounts.set(
          provider,
          selected.find((row) => row.providerId === provider && row.active)?.id ?? null,
        );

      return selected;
    } catch (error) {
      throw new ModelsError(
        "auth",
        `Credential store list failed${providerId ? ` for ${providerId}` : ""}`,
        { cause: error },
      );
    }
  }

  async selectAccount(
    providerId: string,
    accountId: string,
    options?: AuthOperationOptions,
  ): Promise<void> {
    const signal = operationSignal(options?.signal);
    signal.throwIfAborted();

    if (!this.providers.has(providerId))
      throw new ModelsError("provider", `Unknown provider: ${providerId}`);
    let changed = false;

    await this.credentials.modify(
      providerId,
      async (current) => {
        if (!current?.accounts.some((account) => account.id === accountId))
          throw new ModelsError("auth", `Unknown account for ${providerId}: ${accountId}`);

        if (current.active === accountId) return undefined;
        changed = true;

        return { ...current, active: accountId };
      },
      { signal },
    );

    this.activeAccounts.set(providerId, accountId);

    if (!changed) return;

    this.accountLimits.invalidate(providerId);
    this.supersedeProviderRefresh(providerId);
  }

  checkAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthCheck | undefined> {
    const signal = operationSignal(options?.signal);

    const check = (async (): Promise<AuthCheck | undefined> => {
      signal.throwIfAborted();
      const provider = this.providers.get(providerId);

      if (!provider) return undefined;
      const accounts = await this.listAccounts(providerId, { signal });
      const stored = accounts.find((account) => account.active);

      if (accounts.length > 0 && stored === undefined) return undefined;

      if (stored?.type === "oauth") return this.checkOAuthAuth(provider, signal);

      if (stored?.type === "api_key" && provider.auth.apiKey?.check === undefined)
        return provider.auth.apiKey ? { source: "stored credential", type: "api_key" } : undefined;

      const current =
        stored === undefined ? undefined : await this.readAccounts(providerId, signal);

      return this.checkProviderAuth(
        provider,
        current?.accounts.find((account) => account.id === stored?.id)?.credential,
        signal,
      );
    })();

    return raceWithAbortSignal(check, signal);
  }

  verifyAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthVerification> {
    const signal = operationSignal(options?.signal);

    const verification = (async (): Promise<AuthVerification> => {
      signal.throwIfAborted();
      const provider = this.providers.get(providerId);

      if (!provider) {
        return { ok: false, reason: "unconfigured", message: `Unknown provider: ${providerId}` };
      }

      const resolution = await resolveProviderAuth(provider, this.credentials, this.authContext, {
        signal,
      });

      if (!resolution) {
        return {
          ok: false,
          reason: "unconfigured",
          message: `${provider.name} has no credential configured`,
        };
      }

      const source = resolution.source ?? provider.name;
      const verify = provider.auth.verify;

      if (!verify) return { ok: true, source, verified: false };

      try {
        const result = await verify({ auth: resolution.auth, ctx: this.authContext, signal });

        return result.ok ? { ...result, source, verified: result.verified ?? true } : result;
      } catch {
        signal.throwIfAborted();

        return {
          ok: false,
          reason: "unreachable",
          message: `${provider.name} could not be reached to verify the credential`,
        };
      }
    })();

    return raceWithAbortSignal(verification, signal);
  }

  getAvailable(
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly Model<Api>[]> {
    const signal = operationSignal(options?.signal);

    const available = (async () => {
      signal.throwIfAborted();

      const providers = providerId
        ? [this.providers.get(providerId)].filter((entry) => entry !== undefined)
        : this.getProviders();

      const checks = await Promise.all(
        providers.map(async (provider) => {
          const stored = await this.readAccounts(provider.id, signal);
          const credential = stored?.accounts.find(
            (account) => account.id === stored.active,
          )?.credential;

          return {
            provider,
            credential,
            auth:
              stored && !credential
                ? undefined
                : await this.checkProviderAuth(provider, credential, signal),
          };
        }),
      );

      return checks.flatMap(({ provider, credential, auth }) => {
        if (!auth) return [];
        const models = provider.getModels();

        return withFastVariants(provider.filterModels?.(models, credential) ?? models);
      });
    })();

    return raceWithAbortSignal(available, signal);
  }

  getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
  getAuth(model: Model<Api>, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
  async getAuth(
    providerOrModel: string | Model<Api>,
    overrides?: AuthResolutionOverrides,
  ): Promise<AuthResult | undefined> {
    const signal = operationSignal(overrides?.signal);

    const providerId =
      typeof providerOrModel === "string" ? providerOrModel : providerOrModel.provider;

    const provider = this.providers.get(providerId);

    if (!provider) return undefined;

    const result = await resolveProviderAuth(provider, this.credentials, this.authContext, {
      ...overrides,
      signal,
    });

    if (!result || typeof providerOrModel === "string" || !providerOrModel.headers) return result;

    return {
      ...result,
      auth: {
        ...result.auth,
        headers: mergeProviderHeaders(result.auth.headers, providerOrModel.headers),
      },
    };
  }

  async login(
    providerId: string,
    type: AuthType,
    interaction: AuthInteraction,
    label?: string,
  ): Promise<Credential> {
    const signal = operationSignal(interaction.signal);
    signal.throwIfAborted();
    const provider = this.providers.get(providerId);

    if (!provider) throw new ModelsError("provider", `Unknown provider: ${providerId}`);
    const method = type === "oauth" ? provider.auth.oauth : provider.auth.apiKey;

    if (!method?.login) {
      throw new ModelsError("auth", `${provider.name} does not support ${type} login`);
    }

    const accounts = await this.listAccounts(providerId, { signal });
    const name = label?.trim() || `Account ${accounts.length + 1}`;

    const loginOperation: Promise<Credential> = method.login({ ...interaction, signal });
    const credential = await raceWithAbortSignal(loginOperation, signal);

    if (
      credential.type === "api_key" &&
      credential.key !== undefined &&
      credential.key.trim() === ""
    )
      throw new ModelsError("auth", "Enter an API key.");

    let mutationStarted = false;
    let markMutationStarted: (() => void) | undefined;

    const started = new Promise<void>((resolve) => {
      markMutationStarted = resolve;
    });
    const id = uuidv7();

    const mutation = this.credentials.modify(
      providerId,
      async (current) => {
        mutationStarted = true;
        markMutationStarted?.();

        return {
          active: id,
          accounts: [...(current?.accounts ?? []), { id, label: name, credential }],
        };
      },
      { signal },
    );

    void mutation.catch(() => {});

    try {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          if (!mutationStarted) reject(signal.reason);
        };

        signal.addEventListener("abort", onAbort, { once: true });
        void Promise.race([started, mutation])
          .finally(() => signal.removeEventListener("abort", onAbort))
          .then(() => resolve(), reject);

        if (signal.aborted) onAbort();
      });
      await mutation;
    } catch (error) {
      signal.throwIfAborted();
      throw new ModelsError("auth", `Credential store modify failed for ${providerId}`, {
        cause: error,
      });
    }

    // Discovery started for the previous credential must not publish over the new one.
    this.supersedeProviderRefresh(providerId);
    this.activeAccounts.set(providerId, id);
    this.accountLimits.invalidate(providerId);

    return credential;
  }

  async logout(providerId: string, options?: AuthOperationOptions): Promise<void> {
    const signal = operationSignal(options?.signal);
    signal.throwIfAborted();

    try {
      const stored = await this.readAccounts(providerId, signal);
      const id = stored?.active;

      if (id === undefined || id === null) return;

      const post = await this.credentials.modify(
        providerId,
        async (current) => {
          if (!current?.accounts.some((account) => account.id === id)) return undefined;

          return {
            active: current.active === id ? null : current.active,
            accounts: current.accounts.filter((account) => account.id !== id),
          };
        },
        { signal },
      );
      this.activeAccounts.set(providerId, post?.active ?? null);
    } catch (error) {
      signal.throwIfAborted();
      throw new ModelsError("auth", `Credential store delete failed for ${providerId}`, {
        cause: error,
      });
    }

    this.supersedeProviderRefresh(providerId);
    this.accountLimits.invalidate(providerId);
  }

  private requireProvider(model: Model<Api>): Provider {
    const provider = this.providers.get(model.provider);

    if (!provider) {
      throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
    }

    return provider;
  }

  private async applyAuth<
    TModel extends Model<Api>,
    TOptions extends ProviderRequestOptions & ModelsRequestTransforms,
  >(selected: TModel, selectedOptions: TOptions | undefined) {
    const { model, options } = providerRequest(selected, selectedOptions);
    const scope = this.accountLimits.scope(model.provider);

    const resolution = await this.getAuth(model, {
      apiKey: options?.apiKey,
      env: options?.env,
      signal: options?.signal,
    });

    if (!resolution) {
      throw new ModelsError("auth", `Provider is not configured: ${model.provider}`);
    }

    const auth = resolution.auth;

    // Explicit request options win per-field; the Models-only transform runs last.
    const apiKey = options?.apiKey ?? auth.apiKey;
    let headers =
      auth.headers || options?.headers
        ? mergeProviderHeaders(auth.headers, options?.headers)
        : undefined;

    if (options?.transformHeaders) headers = await options.transformHeaders(headers ?? {});

    const env =
      resolution.env || options?.env
        ? { ...(resolution.env ?? {}), ...(options?.env ?? {}) }
        : undefined;

    const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
    const { transformHeaders: _transformHeaders, ...providerOptions } = options ?? {};

    const onAccountLimits: ProviderRequestOptions["onAccountLimits"] = async (
      limits,
      requested,
    ) => {
      scope.observe(resolution.accountId, limits);
      await options?.onAccountLimits?.(limits, requested);
    };

    const requestOptions = { ...providerOptions, apiKey, headers, env, onAccountLimits };

    return { requestModel, requestOptions };
  }

  stream<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): AssistantMessageEventStream {
    const transcript = normalizeContext(context);

    return lazyStream(baseModel(model), async () => {
      const provider = this.requireProvider(model);

      const { requestModel, requestOptions } = await this.applyAuth(model, options);

      return provider.stream<Api>(requestModel, transcript, requestOptions);
    });
  }

  async complete<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): Promise<AssistantMessage> {
    return this.stream(model, context, options).result();
  }

  streamSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): AssistantMessageEventStream {
    const transcript = normalizeContext(context);

    return lazyStream(baseModel(model), async () => {
      const provider = this.requireProvider(model);
      const { requestModel, requestOptions } = await this.applyAuth(model, options);

      return provider.streamSimple(requestModel, transcript, requestOptions);
    });
  }

  async completeSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): Promise<AssistantMessage> {
    return this.streamSimple(model, context, options).result();
  }

  async fetchDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredFetchOptions,
  ): Promise<AssistantMessage> {
    return lazyStream(baseModel(model), async () => {
      const provider = this.requireProvider(model);

      if (!provider.fetchDeferred) {
        throw new ModelsError(
          "provider",
          `Provider ${model.provider} does not support deferred responses`,
        );
      }

      const { requestModel, requestOptions } = await this.applyAuth(model, options);

      return provider.fetchDeferred(requestModel, handle, requestOptions);
    }).result();
  }

  async cancelDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredCancelOptions,
  ): Promise<void> {
    const provider = this.requireProvider(model);

    if (!provider.cancelDeferred) {
      throw new ModelsError(
        "provider",
        `Provider ${model.provider} does not support deferred responses`,
      );
    }

    const { requestModel, requestOptions } = await this.applyAuth(model, options);
    await provider.cancelDeferred(requestModel, handle, requestOptions);
  }
}

export function createModels(options?: CreateModelsOptions): MutableModels {
  return new ModelsImpl(options);
}

export interface CreateProviderOptions<TApi extends Api = Api> {
  id: string;
  /** Display name. Default: `id`. */
  name?: string;
  baseUrl?: string;
  headers?: ProviderHeaders;
  promptCache?: PromptCachePolicy;
  /** Required — every provider has auth semantics, even ambient/keyless ones. */
  auth: ProviderAuth;
  fetchAccountLimits?: Provider<TApi>["fetchAccountLimits"];
  filterModels?: (
    models: readonly Model<TApi>[],
    credential: Credential | undefined,
  ) => readonly Model<TApi>[];
  /** Single implementation, or map keyed by `model.api` for mixed-API providers. */
  api: ProviderStreams | Partial<Record<TApi, ProviderStreams>>;
}

/** Skip the network catalog fetch when the stored one is this fresh, unless forced. */
const CATALOG_FRESHNESS_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * Builds a provider from parts. Built-in and custom provider factories both go through this. A
 * single `api` streams all models; an `api` map dispatches on `model.api`, and a model whose api
 * has no entry is omitted from the catalog and produces a stream error if passed directly.
 */
export function createProvider<TApi extends Api = Api>(
  input: CreateProviderOptions<TApi>,
): Provider<TApi> {
  let catalogModels: readonly Model<TApi>[] = [];
  const api = input.api;
  const single = "streamSimple" in api ? api : undefined;

  const byApi = new Map(
    "streamSimple" in api ? [] : Object.entries<ProviderStreams | undefined>(api),
  );

  const apiFor = (model: Model<Api>): ProviderStreams | undefined => single ?? byApi.get(model.api);

  const usableModels = (catalog: readonly unknown[]): readonly Model<TApi>[] =>
    catalog.filter(
      (model): model is Model<TApi> =>
        Value.Check(ModelSchema, model) &&
        model.provider === input.id &&
        apiFor(model) !== undefined,
    );

  const dispatch = (
    model: Model<Api>,
    run: (streams: ProviderStreams) => AssistantMessageEventStream,
  ): AssistantMessageEventStream => {
    const streams = apiFor(model);

    if (!streams) {
      return lazyStream(model, async () => {
        throw new ModelsError(
          "stream",
          `Provider ${input.id} has no API implementation for "${model.api}"`,
        );
      });
    }

    return run(streams);
  };

  const provider: Provider<TApi> = {
    id: input.id,
    name: input.name ?? input.id,
    baseUrl: input.baseUrl,
    headers: input.headers,
    promptCache: input.promptCache,
    auth: input.auth,
    fetchAccountLimits: input.fetchAccountLimits,
    getModels: () => catalogModels,
    refreshModels: async (context) => {
      if (context.stored) {
        const restored = usableModels(context.stored.models);

        if (
          !(await context.publish({
            update: () => {
              catalogModels = restored;
            },
          }))
        ) {
          return;
        }
      }

      if (!context.allowNetwork || context.signal.aborted) return;

      if (
        context.force !== true &&
        context.stored?.checkedAt !== undefined &&
        Date.now() - context.stored.checkedAt < CATALOG_FRESHNESS_WINDOW_MS
      ) {
        return;
      }

      const headers = new Headers({ Accept: "application/json" });

      if (context.stored?.etag !== undefined) {
        headers.set("If-None-Match", context.stored.etag);
      }

      let response: Response;

      try {
        response = await context.catalog.fetch(
          `${context.catalog.url.replace(/\/+$/u, "")}/${input.id}.json`,
          {
            headers,
            signal: context.signal,
            redirect: "error",
          },
        );
      } catch (error) {
        context.signal.throwIfAborted();
        throw new ModelsError("model_source", `Model catalog request failed for ${input.id}`, {
          cause: error,
        });
      }

      const checkedAt = Date.now();

      if (response.status === 304) {
        if (!context.stored) {
          throw new ModelsError(
            "model_source",
            `Model catalog request failed for ${input.id} (HTTP 304 without cached models)`,
          );
        }

        await context.publish({ persist: { ...context.stored, checkedAt } });

        return;
      }

      if (response.status !== 200) {
        throw new ModelsError(
          "model_source",
          `Model catalog request failed for ${input.id} (HTTP ${String(response.status)})`,
        );
      }

      let value: unknown;

      try {
        value = await response.json();
      } catch {
        throw new ModelsError(
          "model_source",
          `Model catalog request failed for ${input.id} (HTTP 200, invalid JSON)`,
        );
      }

      if (!Array.isArray(value)) {
        throw new ModelsError(
          "model_source",
          `Model catalog request failed for ${input.id} (HTTP 200, expected an array)`,
        );
      }

      const refreshed = usableModels(value);

      const lastModifiedHeader = response.headers.get("Last-Modified");

      const parsedLastModified =
        lastModifiedHeader === null ? undefined : Date.parse(lastModifiedHeader);

      const lastModified =
        parsedLastModified === undefined || Number.isNaN(parsedLastModified)
          ? undefined
          : parsedLastModified;

      if (context.signal.aborted) return;
      await context.publish({
        persist: {
          models: value,
          etag: response.headers.get("ETag") ?? undefined,
          lastModified,
          checkedAt,
        },
        update: () => {
          catalogModels = refreshed;
        },
      });
    },
    filterModels: input.filterModels,
    stream: (model, context, options) =>
      dispatch(model, (streams) => streams.stream(model, context, options)),
    streamSimple: (model, context, options) =>
      dispatch(model, (streams) => streams.streamSimple(model, context, options)),
  };

  const streams = single ? [single] : [...byApi.values()].filter((entry) => entry !== undefined);

  if (streams.some((entry) => entry.fetchDeferred !== undefined)) {
    provider.fetchDeferred = (model, handle, options) =>
      lazyStream(model, async () => {
        const implementation = apiFor(model);

        if (!implementation?.fetchDeferred) {
          throw new ModelsError(
            "provider",
            `Provider ${input.id} does not support deferred responses for "${model.api}"`,
          );
        }

        return implementation.fetchDeferred(model, handle, options);
      });
  }

  if (streams.some((entry) => entry.cancelDeferred !== undefined)) {
    provider.cancelDeferred = async (model, handle, options) => {
      const implementation = apiFor(model);

      if (!implementation?.cancelDeferred) {
        throw new ModelsError(
          "provider",
          `Provider ${input.id} cannot cancel deferred responses for "${model.api}"`,
        );
      }

      await implementation.cancelDeferred(model, handle, options);
    };
  }

  return provider;
}

/**
 * Runtime-checked narrowing for dynamically looked-up models:
 *
 * ```ts
 * const model = models.getModel("anthropic", "claude-opus-4-7");
 * if (model && hasApi(model, "anthropic-messages")) {
 *   // model: Model<"anthropic-messages">, stream options fully typed
 * }
 * ```
 */
export function hasApi<TApi extends Api>(model: Model<Api>, api: TApi): model is Model<TApi> {
  return model.api === api;
}

export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
  const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  let rates: ModelCostRates = model.cost;
  let matchedThreshold = -1;

  for (const tier of model.cost.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
      rates = tier;
      matchedThreshold = tier.inputTokensAbove;
    }
  }

  // Anthropic charges 2x base input for 1h cache writes.
  const longWrite = usage.cacheWrite1h ?? 0;
  const shortWrite = usage.cacheWrite - longWrite;
  usage.cost.input = (rates.input / 1000000) * usage.input;
  usage.cost.output = (rates.output / 1000000) * usage.output;
  usage.cost.cacheRead = (rates.cacheRead / 1000000) * usage.cacheRead;
  usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1000000;
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;

  return usage.cost;
}

export function getSupportedThinkingLevels<TApi extends Api>(
  model: Model<TApi>,
): ModelThinkingLevel[] {
  if (!model.reasoning) return ["off"];

  return MODEL_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];

    if (mapped === null) return false;

    if (level === "xhigh" || level === "max") return mapped !== undefined;

    return true;
  });
}

export function clampThinkingLevel<TApi extends Api>(
  model: Model<TApi>,
  level: ModelThinkingLevel,
): ModelThinkingLevel {
  const availableLevels = getSupportedThinkingLevels(model);

  if (availableLevels.includes(level)) return level;

  const requestedIndex = MODEL_THINKING_LEVELS.indexOf(level);

  if (requestedIndex === -1) return availableLevels[0] ?? "off";

  for (let i = requestedIndex; i < MODEL_THINKING_LEVELS.length; i++) {
    const candidate = MODEL_THINKING_LEVELS[i];

    if (availableLevels.includes(candidate)) return candidate;
  }

  for (let i = requestedIndex - 1; i >= 0; i--) {
    const candidate = MODEL_THINKING_LEVELS[i];

    if (availableLevels.includes(candidate)) return candidate;
  }

  return availableLevels[0] ?? "off";
}

/**
 * Check if two models are equal by comparing both their id and provider.
 * Returns false if either model is null or undefined.
 */
export function modelsAreEqual<TApi extends Api>(
  a: Model<TApi> | null | undefined,
  b: Model<TApi> | null | undefined,
): boolean {
  if (!a || !b) return false;

  return a.id === b.id && a.provider === b.provider;
}
