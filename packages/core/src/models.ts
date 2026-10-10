import { getSupportedThinkingLevels } from "@nyte-ai/ai/models";
import type { AuthEvent, AuthInteraction, AuthPrompt, Models, Provider } from "@nyte-ai/ai";
import type {
  LoginMethod,
  ModelCatalogView,
  ModelInfo,
  ModelRef,
  SessionId,
} from "@nyte-ai/schema";
import type { Api, Model } from "@nyte-ai/schema/model";
import { bumpGeneration } from "./catalog.ts";
import type { Login, ModelsApi } from "./connection.ts";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import type { ModelContextPolicy } from "./plugin.ts";
import { decodeKvValue } from "./records.ts";
import { kvRef } from "./refs.ts";
import { commit, isJsonObject, put } from "./session-state.ts";

/** Returns one step a login yields. */
type LoginStep = Login["steps"] extends () => AsyncIterable<infer Step> ? Step : never;

/** Returns a provider row of the catalog. */
type ProviderRow = ModelCatalogView["providers"][number];

/** Returns what `verify` last proved about a provider's credential, kept per kernel. */
type Verdict = "verified" | "failed";

/** Returns the prompt a login is waiting on: what `answer` resolves it with, and the option ids a `choose` step accepts (null for `paste`). */
interface Pending {
  readonly options: readonly string[] | null;
  resolve(value: string): void;
}

const DEFAULT_MODEL = kvRef("host", "models", "default");

const verdicts = new WeakMap<Kernel, Map<string, Verdict>>();

/** Returns the host's models api over `@nyte-ai/ai`'s `Models`: what `kernel.models` holds and every connection's `models` checks authority over. `list` is `modelCatalog`. `refresh(provider?)` runs `models.refresh({ providers })` for one provider or all, throws `SdkError("unavailable")` naming each provider whose refresh failed, and bumps the catalog generation (`bumpGeneration`). `setDefault(ref)` answers `unknown-model` when `models.getModel(ref.provider, ref.id)` has no such model, else stores the ref as a `kv` envelope at `kvRef("host", "models", "default")`, bumps the generation and answers `set`. `verify(provider)` runs `models.verifyAuth(provider)` and caches the verdict per kernel for the catalog's `credential`: `ok` and `verified` → `verified`, cached; `ok` without a provider check (`verified: false`) → `unverified` (§38d), caching nothing, so the catalog keeps `configured`; not `ok` → `failed { reason: message }`, cached `failed` unless the reason is `unconfigured`; it bumps the generation when the cached state changed. `login(input)` is `createLogin`. `logout(provider)` runs `models.logout(provider)`, drops the cached verdict and bumps the generation. */
export function createModelsApi(kernel: Kernel, models: Models): ModelsApi {
  const remember = (provider: string, verdict: Verdict): void => {
    const known = verdictsOf(kernel);

    if (known.get(provider) === verdict) return;
    known.set(provider, verdict);
    bumpGeneration(kernel);
  };

  return {
    list: () => modelCatalog(kernel, models),
    async refresh(provider) {
      const result = await models.refresh({
        providers: provider === undefined ? undefined : [provider],
      });

      bumpGeneration(kernel);

      if (result.errors.size === 0) return;

      throw new SdkError(
        "unavailable",
        `Refreshing models failed for ${[...result.errors]
          .map(([id, error]) => `${id} (${error.message})`)
          .join(", ")}.`,
      );
    },
    async setDefault(ref) {
      if (models.getModel(ref.provider, ref.id) === undefined) return { kind: "unknown-model" };

      await commit(kernel, [
        {
          name: DEFAULT_MODEL,
          target: await put(kernel, "kv", { provider: ref.provider, id: ref.id }),
        },
      ]);
      bumpGeneration(kernel);

      return { kind: "set" };
    },
    async verify(provider) {
      let verification: Awaited<ReturnType<Models["verifyAuth"]>>;

      try {
        verification = await models.verifyAuth(provider);
      } catch (error) {
        remember(provider, "failed");

        return { kind: "failed", reason: messageOf(error) };
      }

      if (verification.ok) {
        if (!verification.verified) return { kind: "unverified" };
        remember(provider, "verified");

        return { kind: "verified" };
      }

      if (verification.reason !== "unconfigured") remember(provider, "failed");

      return { kind: "failed", reason: verification.message };
    },
    login: (input) => createLogin(kernel, models, input),
    async logout(provider) {
      await models.logout(provider);
      verdictsOf(kernel).delete(provider);
      bumpGeneration(kernel);
    },
  };
}

/** Projects `Models` as the host's catalog. `generation` is `kernel.host.current().catalog`; `default` is `defaultModel`. One provider row per `models.getProviders()` entry, in that order: `id` and `name` from the provider; `credential` from `models.checkAuth(id)` (undefined → `missing`, a rejection → `failed`) refined by the per-kernel verdict `verify` cached (`verified` or `failed`, else `configured`); `methods` from the provider's auth (`{ kind: "key" }` when `auth.apiKey.login` exists, `{ kind: "oauth" }` when `auth.oauth` exists; a device-code flow is an oauth login whose `open` step carries a code, §38a); `limits` from `models.getAccountLimits(id)` (`limitsOf`), one per window with `label` its id, `used` its `usedPercent`, `limit` 100 and `resetsAt` its reset time or null when the provider gave none (§38c), empty before any request, and moving `generation` whenever a request changes them (`withLimits`); `models` the provider's base models (`models.getModels(id)` without a `variant`), each through the same projection as `modelInfo`, with the `ModelContextPolicy` overrides of the static `contribute.modelContext` of `kernel.builtins` then `kernel.hostPlugins` (a later entry for a ref wins). */
export async function modelCatalog(kernel: Kernel, models: Models): Promise<ModelCatalogView> {
  const generation = kernel.host.current().catalog;
  const policies = staticPolicies(kernel);
  const cached = verdictsOf(kernel);

  const [preferred, providers] = await Promise.all([
    defaultModel(kernel, models),
    Promise.all(
      models.getProviders().map(async (provider): Promise<ProviderRow> => ({
        id: provider.id,
        name: provider.name,
        credential: await credentialOf(models, provider.id, cached.get(provider.id)),
        methods: methodsOf(provider),
        limits: limitsOf(models, provider.id),
        models: models
          .getModels(provider.id)
          .filter((model) => model.variant === undefined)
          .map((model) => projectModel(models, model, policies.get(keyOf(model)))),
      })),
    ),
  ]);

  return { generation, default: preferred, providers };
}

/** Returns one catalog model as `ModelInfo`, or null when `models.getModel(ref.provider, ref.id)` has none; a fast sibling (`<id>-fast`, a `variant` of mode `fast`) resolves to its own row. `name`, `reasoning`, `input` and `cost` (the base rates; tiers are priced at settlement) come from the model; `maxOutput` is `maxTokens`; `thinking` is `getSupportedThinkingLevels(model)` from `@nyte-ai/ai/models` (§38i; `["off"]` when the model does not reason, else every level its `thinkingLevelMap` does not mark null, `xhigh` and `max` only when mapped), `"off"` first; `fast` is the sibling `models.getModels(provider)` lists with `variant: { mode: "fast", base: id }`, else null; `contextWindow` and `compactAt` are the model's window and 80 % of it unless a `ModelContextPolicy` names the ref: the session's `modelContext` registry when `session` is given, else the host's static ones as `modelCatalog` folds them. */
export async function modelInfo(
  kernel: Kernel,
  models: Models,
  ref: ModelRef,
  session?: SessionId,
): Promise<ModelInfo | null> {
  const model = models.getModel(ref.provider, ref.id);

  if (model === undefined) return null;

  const policy =
    session === undefined
      ? staticPolicies(kernel).get(keyOf(ref))
      : kernel
          .pluginsFor(session)
          .registries.modelContext.list()
          .findLast((entry) => keyOf(entry.model) === keyOf(ref));

  return projectModel(models, model, policy);
}

/** Returns one login attempt. Nothing runs until `steps()` is iterated; then `models.login(provider, type, interaction)` starts, `type` being `"api_key"` for `key` and `"oauth"` for `oauth`, under an `AbortController` the iterator's `return()` aborts (the attempt is cancelled; a saved credential is never removed). The `AuthInteraction` yields steps in order (§38b): `auth_url` → `open { url }`; `device_code` → `open { url: verificationUri, code: userCode }` (a device-code flow, §38a); `progress` and `info` → `waiting`; a `text`, `secret` or `manual_code` prompt → `paste { message, secret }`, `secret` true for a `secret` prompt; a `select` prompt → `choose { message, options }` with each option's `id` and `label`. A prompt resolves with the next `answer(value)` and rejects when the attempt is cancelled or the prompt's own `signal` aborts (the step is then stale; the flow goes on). The flow resolving yields `done`, drops the cached verdict and bumps the catalog generation; rejecting yields `failed { reason }` with the error's message. `answer` throws `SdkError("invalid")` with no prompt pending, or after a `choose` with an id not among its options. */
export function createLogin(
  kernel: Kernel,
  models: Models,
  input: { readonly provider: string; readonly method: LoginMethod },
): Login {
  let pending: Pending | null = null;

  async function* steps(): AsyncGenerator<LoginStep> {
    const controller = new AbortController();
    const queue: LoginStep[] = [];
    let wake: (() => void) | null = null;

    const push = (step: LoginStep): void => {
      queue.push(step);
      wake?.();
      wake = null;
    };

    const interaction: AuthInteraction = {
      signal: controller.signal,
      notify: (event) => push(stepOf(event)),
      prompt: (prompt) =>
        new Promise<string>((resolve, reject) => {
          const signal =
            prompt.signal === undefined
              ? controller.signal
              : AbortSignal.any([controller.signal, prompt.signal]);

          const entry: Pending = {
            options: prompt.type === "select" ? prompt.options.map((option) => option.id) : null,
            resolve(value) {
              signal.removeEventListener("abort", cancel);
              resolve(value);
            },
          };

          const cancel = (): void => {
            if (pending === entry) pending = null;
            reject(new SdkError("unavailable", "The login step was cancelled."));
          };

          if (signal.aborted) {
            cancel();

            return;
          }

          signal.addEventListener("abort", cancel, { once: true });
          pending = entry;
          push(promptStep(prompt));
        }),
    };

    void models
      .login(input.provider, input.method.kind === "key" ? "api_key" : "oauth", interaction)
      .then(
        () => {
          verdictsOf(kernel).delete(input.provider);
          bumpGeneration(kernel);
          push({ kind: "done" });
        },
        (error: unknown) => push({ kind: "failed", reason: messageOf(error) }),
      );

    try {
      for (;;) {
        const next = queue.shift();

        if (next === undefined) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }

        yield next;

        if (next.kind === "done" || next.kind === "failed") return;
      }
    } finally {
      pending = null;
      controller.abort();
    }
  }

  return {
    steps,
    async answer(code) {
      const current = pending;

      if (current === null)
        throw new SdkError("invalid", "No login step is waiting for an answer.");

      if (current.options !== null && !current.options.includes(code))
        throw new SdkError("invalid", `${code} is not one of the options.`);
      pending = null;
      current.resolve(code);
    },
  };
}

/** Sends one provider request through `send` and bumps the catalog generation (`bumpGeneration`) when the provider's account limits as the catalog shows them (`limitsOf`) differ after it, whether it resolved or threw; a response that observed the same windows again moves nothing. Every request core sends to a provider goes through it: the turn's, `request`'s, and compaction's and summaries'. */
export async function withLimits<T>(
  kernel: Kernel,
  models: Models,
  provider: string,
  send: () => Promise<T>,
): Promise<T> {
  const before = JSON.stringify(limitsOf(models, provider));

  try {
    return await send();
  } finally {
    if (JSON.stringify(limitsOf(models, provider)) !== before) bumpGeneration(kernel);
  }
}

/** Returns the model `sessions.create` uses when nothing is chosen: the ref stored at `kvRef("host", "models", "default")` while the catalog still has it; else the first base model of the first provider in `models.getProviders()` order whose `checkAuth` is configured; null when no provider is configured. */
export async function defaultModel(kernel: Kernel, models: Models): Promise<ModelRef | null> {
  const ref = await kernel.store.refs.get(DEFAULT_MODEL);

  const stored = ref?.target
    ? decodeKvValue(await kernel.store.objects.get(ref.target))
    : undefined;

  if (
    isJsonObject(stored) &&
    typeof stored.provider === "string" &&
    typeof stored.id === "string" &&
    models.getModel(stored.provider, stored.id) !== undefined
  )
    return { provider: stored.provider, id: stored.id };

  for (const provider of models.getProviders()) {
    if ((await models.checkAuth(provider.id).catch(() => undefined)) === undefined) continue;
    const base = models.getModels(provider.id).find((model) => model.variant === undefined);

    if (base !== undefined) return { provider: base.provider, id: base.id };
  }

  return null;
}

/** Returns a catalog model as `ModelInfo` under an optional context policy. */
function projectModel(
  models: Models,
  model: Model<Api>,
  policy: ModelContextPolicy | undefined,
): ModelInfo {
  const fast = models
    .getModels(model.provider)
    .find((other) => other.variant?.mode === "fast" && other.variant.base === model.id);

  return {
    ref: { provider: model.provider, id: model.id },
    name: model.name,
    reasoning: model.reasoning,
    thinking: ["off", ...getSupportedThinkingLevels(model).filter((level) => level !== "off")],
    fast: fast === undefined ? null : { provider: fast.provider, id: fast.id },
    contextWindow: policy?.contextWindow ?? model.contextWindow,
    compactAt: policy?.compactAt ?? Math.floor(model.contextWindow * 0.8),
    maxOutput: model.maxTokens,
    input: [...model.input],
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite,
    },
  };
}

/** Returns the static `ModelContextPolicy` contributions of the built-ins then the host plugins by `<provider>/<id>`, a later entry winning. */
function staticPolicies(kernel: Kernel): ReadonlyMap<string, ModelContextPolicy> {
  const policies = new Map<string, ModelContextPolicy>();

  for (const plugin of [...kernel.builtins, ...kernel.hostPlugins])
    for (const policy of plugin.contribute?.modelContext ?? [])
      policies.set(keyOf(policy.model), policy);

  return policies;
}

/** Returns a provider's credential state: `missing` without auth, `failed` when the check rejects, else what `verify` cached, else `configured`. */
async function credentialOf(
  models: Models,
  provider: string,
  cached: Verdict | undefined,
): Promise<ProviderRow["credential"]> {
  try {
    return (await models.checkAuth(provider)) === undefined ? "missing" : (cached ?? "configured");
  } catch {
    return "failed";
  }
}

/** Returns how a provider's credential can be obtained. */
function methodsOf(provider: Provider): readonly LoginMethod[] {
  const methods: LoginMethod[] = [];

  if (provider.auth.oauth !== undefined) methods.push({ kind: "oauth" });

  if (provider.auth.apiKey?.login !== undefined) methods.push({ kind: "key" });

  return methods;
}

/** Returns a provider's account limits as its catalog row shows them: one per window of `models.getAccountLimits(provider)`, `label` its id, `used` its `usedPercent`, `limit` 100, `resetsAt` its reset time or null (§38c); empty before any request. */
function limitsOf(models: Models, provider: string): ProviderRow["limits"] {
  return (models.getAccountLimits(provider)?.windows ?? []).map((window) => ({
    label: window.id,
    used: window.usedPercent,
    limit: 100,
    resetsAt: window.resetsAt ?? null,
  }));
}

/** Returns the step a login event shows. */
function stepOf(event: AuthEvent): LoginStep {
  switch (event.type) {
    case "auth_url":
      return { kind: "open", url: event.url };
    case "device_code":
      return { kind: "open", url: event.verificationUri, code: event.userCode };
    case "info":
    case "progress":
      return { kind: "waiting" };
  }
}

/** Returns the step a login prompt shows. */
function promptStep(prompt: AuthPrompt): LoginStep {
  if (prompt.type === "select")
    return {
      kind: "choose",
      message: prompt.message,
      options: prompt.options.map((option) => ({ id: option.id, label: option.label })),
    };

  return { kind: "paste", message: prompt.message, secret: prompt.type === "secret" };
}

/** Returns `<provider>/<id>`: how policies are keyed. */
function keyOf(ref: Pick<ModelRef, "provider" | "id">): string {
  return `${ref.provider}/${ref.id}`;
}

/** Returns the kernel's cached verdicts, created on first use. */
function verdictsOf(kernel: Kernel): Map<string, Verdict> {
  const known = verdicts.get(kernel) ?? new Map<string, Verdict>();
  verdicts.set(kernel, known);

  return known;
}

/** Returns an error's message, or the thrown value as text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
