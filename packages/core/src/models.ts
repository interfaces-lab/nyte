import type { Models } from "@nyte-ai/ai";
import type {
  LoginMethod,
  ModelCatalogView,
  ModelInfo,
  ModelRef,
  SessionId,
} from "@nyte-ai/schema";
import type { Login, ModelsApi } from "./connection.ts";
import type { Kernel } from "./kernel.ts";

/** Returns the host's models api over `@nyte-ai/ai`'s `Models`: what `kernel.models` holds and every connection's `models` checks authority over. `list` is `modelCatalog`. `refresh(provider?)` runs `models.refresh({ providers })` for one provider or all, throws `SdkError("unavailable")` naming each provider whose refresh failed, and bumps the catalog generation (`bumpGeneration`). `setDefault(ref)` answers `unknown-model` when `models.getModel(ref.provider, ref.id)` has no such model, else stores the ref as a `kv` envelope at `kvRef("host", "models", "default")`, bumps the generation and answers `set`. `verify(provider)` runs `models.verifyAuth(provider)` and caches the verdict per kernel for the catalog's `credential`: `ok` and `verified` → `verified`, cached; `ok` without a provider check (`verified: false`) → `unverified` (§38d), caching nothing, so the catalog keeps `configured`; not `ok` → `failed { reason: message }`, cached `failed` unless the reason is `unconfigured`; it bumps the generation when the cached state changed. `login(input)` is `createLogin`. `logout(provider)` runs `models.logout(provider)`, drops the cached verdict and bumps the generation. */
export function createModelsApi(kernel: Kernel, models: Models): ModelsApi {
  throw new Error("not implemented");
}

/** Projects `Models` as the host's catalog. `generation` is `kernel.host.current().catalog`; `default` is `defaultModel`. One provider row per `models.getProviders()` entry, in that order: `id` and `name` from the provider; `credential` from `models.checkAuth(id)` (undefined → `missing`, a rejection → `failed`) refined by the per-kernel verdict `verify` cached (`verified` or `failed`, else `configured`); `methods` from the provider's auth (`{ kind: "key" }` when `auth.apiKey.login` exists, `{ kind: "oauth" }` when `auth.oauth` exists; a device-code flow is an oauth login whose `open` step carries a code, §38a); `limits` from `models.getAccountLimits(id)`, one per window with `label` its id, `used` its `usedPercent`, `limit` 100 and `resetsAt` its reset time or null when the provider gave none (§38c), empty before any request; `models` the provider's base models (`models.getModels(id)` without a `variant`), each through the same projection as `modelInfo`, with the `ModelContextPolicy` overrides of the static `contribute.modelContext` of `kernel.builtins` then `kernel.hostPlugins` (a later entry for a ref wins). */
export function modelCatalog(kernel: Kernel, models: Models): Promise<ModelCatalogView> {
  throw new Error("not implemented");
}

/** Returns one catalog model as `ModelInfo`, or null when `models.getModel(ref.provider, ref.id)` has none; a fast sibling (`<id>-fast`, a `variant` of mode `fast`) resolves to its own row. `name`, `reasoning`, `input` and `cost` (the base rates; tiers are priced at settlement) come from the model; `maxOutput` is `maxTokens`; `thinking` is `getSupportedThinkingLevels(model)` from `@nyte-ai/ai/models` (§38i; `["off"]` when the model does not reason, else every level its `thinkingLevelMap` does not mark null, `xhigh` and `max` only when mapped), `"off"` first; `fast` is the sibling `models.getModels(provider)` lists with `variant: { mode: "fast", base: id }`, else null; `contextWindow` and `compactAt` are the model's window and 80 % of it unless a `ModelContextPolicy` names the ref: the session's `modelContext` registry when `session` is given, else the host's static ones as `modelCatalog` folds them. */
export function modelInfo(
  kernel: Kernel,
  models: Models,
  ref: ModelRef,
  session?: SessionId,
): Promise<ModelInfo | null> {
  throw new Error("not implemented");
}

/** Returns one login attempt. Nothing runs until `steps()` is iterated; then `models.login(provider, type, interaction)` starts, `type` being `"api_key"` for `key` and `"oauth"` for `oauth`, under an `AbortController` the iterator's `return()` aborts (the attempt is cancelled; a saved credential is never removed). The `AuthInteraction` yields steps in order (§38b): `auth_url` → `open { url }`; `device_code` → `open { url: verificationUri, code: userCode }` (a device-code flow, §38a); `progress` and `info` → `waiting`; a `text`, `secret` or `manual_code` prompt → `paste { message, secret }`, `secret` true for a `secret` prompt; a `select` prompt → `choose { message, options }` with each option's `id` and `label`. A prompt resolves with the next `answer(value)` and rejects when the attempt is cancelled or the prompt's own `signal` aborts (the step is then stale; the flow goes on). The flow resolving yields `done`, drops the cached verdict and bumps the catalog generation; rejecting yields `failed { reason }` with the error's message. `answer` throws `SdkError("invalid")` with no prompt pending, or after a `choose` with an id not among its options. */
export function createLogin(
  kernel: Kernel,
  models: Models,
  input: { readonly provider: string; readonly method: LoginMethod },
): Login {
  throw new Error("not implemented");
}

/** Returns the model `sessions.create` uses when nothing is chosen: the ref stored at `kvRef("host", "models", "default")` while the catalog still has it; else the first base model of the first provider in `models.getProviders()` order whose `checkAuth` is configured; null when no provider is configured. */
export function defaultModel(kernel: Kernel, models: Models): Promise<ModelRef | null> {
  throw new Error("not implemented");
}
