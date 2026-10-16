/**
 * The provider and model registry contracts: what a provider implements and
 * what `Models` offers its callers.
 */
import { type AuthResolutionOverrides } from "./auth/resolve.ts";
import type {
  AuthCheck,
  AuthContext,
  AuthInteraction,
  AuthOperationOptions,
  AuthResult,
  AuthType,
  AuthVerification,
  Credential,
  CredentialInfo,
  CredentialStore,
  ModelAuth,
  ProviderAuth,
} from "./auth/types.ts";
import type { ApiStreamOptions } from "./api-options.ts";
import { type ModelsStore, type ModelsStoreEntry } from "./models-store.ts";
import type {
  AccountLimits,
  AccountLimitsResult,
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  DeferredCancelOptions,
  DeferredFetchOptions,
  DeferredHandle,
  FetchFunction,
  Model,
  PromptCachePolicy,
  ProviderHeaders,
  SimpleStreamOptions,
  TranscriptContext,
} from "./types.ts";

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

export interface CreateModelsOptions {
  credentials?: CredentialStore;
  modelsStore?: ModelsStore;
  authContext?: AuthContext;
  catalog?: {
    url?: string;
    fetch?: FetchFunction;
  };
}
