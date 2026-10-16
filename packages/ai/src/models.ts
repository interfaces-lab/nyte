import { normalizeContext } from "@nyte-ai/schema/model";
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
} from "./auth/types.ts";
import { InMemoryModelsStore, type ModelsStore } from "./models-store.ts";
import { baseModel, providerRequest, withFastVariants } from "./model-variants.ts";
import type {
  AccountLimits,
  AccountLimitsResult,
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  DeferredHandle,
  Model,
  ProviderRequestOptions,
} from "./types.ts";
import { operationSignal, raceWithAbortSignal } from "./utils/abort.ts";
import { mergeProviderHeaders } from "./utils/headers.ts";
import { uuidv7 } from "./utils/uuid.ts";
import { CatalogRefreshes } from "./models-refresh.ts";
import type {
  CreateModelsOptions,
  Models,
  ModelsApiStreamOptions,
  ModelsDeferredCancelOptions,
  ModelsDeferredFetchOptions,
  ModelsRefreshOptions,
  ModelsRefreshResult,
  ModelsRequestTransforms,
  ModelsSimpleStreamOptions,
  MutableModels,
  Provider,
  RefreshModelsContext,
} from "./models-types.ts";

export { ModelsError, type ModelsErrorCode } from "./auth/resolve.ts";

export {
  calculateCost,
  clampThinkingLevel,
  getSupportedThinkingLevels,
  hasApi,
  modelsAreEqual,
} from "./model-capabilities.ts";

export type {
  CreateModelsOptions,
  Models,
  ModelsApiStreamOptions,
  ModelsDeferredCancelOptions,
  ModelsDeferredFetchOptions,
  ModelsPublication,
  ModelsRefreshOptions,
  ModelsRefreshResult,
  ModelsRequestTransforms,
  ModelsSimpleStreamOptions,
  MutableModels,
  Provider,
  RefreshModelsContext,
} from "./models-types.ts";

export { createProvider, type CreateProviderOptions } from "./provider.ts";

export const DEFAULT_MODELS_CATALOG_URL = "https://pub-426b80ba181f408387bc9361b2fcbe3f.r2.dev";

class ModelsImpl implements MutableModels {
  private providers = new Map<string, Provider>();
  private credentials: CredentialStore;
  private modelsStore: ModelsStore;
  private authContext: AuthContext;
  private catalog: RefreshModelsContext["catalog"];
  private accountLimits: AccountLimitsCache;
  private activeAccounts: Map<string, string | null>;
  private refreshes: CatalogRefreshes;

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
    this.refreshes = new CatalogRefreshes(this.modelsStore, this.catalog);
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
    this.refreshes.supersede(provider.id);
    this.providers.set(provider.id, provider);
  }

  deleteProvider(id: string): void {
    this.refreshes.supersede(id);
    this.providers.delete(id);
  }

  clearProviders(): void {
    for (const id of new Set([...this.providers.keys(), ...this.refreshes.running()])) {
      this.refreshes.supersede(id);
    }

    this.providers.clear();
  }

  getProviders(): readonly Provider[] {
    return Array.from(this.providers.values());
  }

  getProvider(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  /** Best-effort: a provider whose `getModels` throws contributes no models. */
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
        continue;
      }
    }

    return models;
  }

  getModel(provider: string, id: string): Model<Api> | undefined {
    return this.getModels(provider).find((model) => model.id === id);
  }

  async refresh(options: ModelsRefreshOptions = {}): Promise<ModelsRefreshResult> {
    const allowNetwork = options.allowNetwork ?? true;
    const callerSignal = operationSignal(options.signal);
    const errors = new Map<string, Error>();

    if (callerSignal.aborted) return { aborted: true, errors };
    const selected = options.providers ? new Set(options.providers) : undefined;

    const refresh = Promise.all(
      Array.from(this.providers.values()).map(async (provider) => {
        if (provider.refreshModels === undefined || (selected && !selected.has(provider.id))) {
          return;
        }

        const error = await this.refreshes.run(
          provider,
          allowNetwork,
          options.force,
          callerSignal,
          (signal) => this.readAccounts(provider.id, signal),
          (accounts, signal) => this.resolveRefreshCredential(provider, accounts, signal),
        );

        if (error !== undefined) errors.set(provider.id, error);
      }),
    );

    try {
      await raceWithAbortSignal(refresh, callerSignal);
    } catch (error) {
      if (!callerSignal.aborted) throw error;
    }

    return { aborted: callerSignal.aborted, errors: new Map(errors) };
  }

  /**
   * The credential a catalog refresh uses. An expired OAuth credential refreshes under the
   * credential lock, with the request path's timeout cap, since a hung request there would
   * block every other client.
   */
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
    this.refreshes.supersede(providerId);
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

  /** Logs in and stores the credential; a catalog refresh started for the previous one is superseded so it cannot publish over the new one. */
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

    this.refreshes.supersede(providerId);
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

    this.refreshes.supersede(providerId);
    this.accountLimits.invalidate(providerId);
  }

  private requireProvider(model: Model<Api>): Provider {
    const provider = this.providers.get(model.provider);

    if (!provider) {
      throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
    }

    return provider;
  }

  /** Request auth for a model: explicit request options win per field, and the Models-only transform runs last. */
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
