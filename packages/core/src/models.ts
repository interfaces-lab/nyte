import type { AuthEvent, AuthInteraction, AuthPrompt, Models, Provider } from "@nyte-ai/ai";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@nyte-ai/ai/models";
import type {
  Configuration,
  ConfigurationPatch,
  ConfigureOutcome,
  Json,
  LoginMethod,
  ModelCatalogView,
  ModelInfo,
  ModelRef,
  Thinking,
  ValidationIssue,
} from "@nyte-ai/schema";
import type { Api, Model } from "@nyte-ai/schema/model";
import type { Login, ModelsApi } from "./connection.ts";
import { objectId } from "./content.ts";
import { SdkError } from "./error.ts";
import { check } from "./json-schema.ts";
import type { ConfigurationResolver, Kernel } from "./kernel.ts";
import { pluginState, readKv } from "./plugin-runtime.ts";
import type { PluginRuntime } from "./plugin-runtime.ts";
import type { Agent, ModelContextPolicy, SettingDefinition } from "./plugin.ts";
import { kvRef } from "./refs.ts";
import { bumpGeneration, jsonSchemaOf } from "./registry.ts";
import { commit, isJsonObject, put } from "./session-state.ts";

type LoginStep = Login["steps"] extends () => AsyncIterable<infer Step> ? Step : never;

type ProviderRow = ModelCatalogView["providers"][number];

type Verdict = "verified" | "failed";

/** The prompt a login waits on, with the option ids a `choose` step accepts (null for `paste`). */
interface Pending {
  readonly options: readonly string[] | null;
  resolve(value: string): void;
}

const DEFAULT_MODEL = kvRef("host", "models", "default");

/** Returns the host's models api over `@nyte-ai/ai`'s `Models`. `verify` caches a proven verdict per kernel for the catalog's `credential` (an unverified `ok` caches nothing, §38d); `refresh`, `setDefault`, `verify`, `login` and `logout` bump the catalog generation when what the catalog shows moved. `refresh` throws `unavailable` naming each provider that failed. */
export function createModelsApi(kernel: Kernel, models: Models): ModelsApi {
  const remember = (provider: string, verdict: Verdict): void => {
    const known = pluginState(kernel).verdicts;

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
      pluginState(kernel).verdicts.delete(provider);
      bumpGeneration(kernel);
    },
  };
}

/** Projects `Models` as the host's catalog: one row per provider, its credential refined by the cached verdict, its login methods, account limits (§38c) and base models. Models are projected as `modelInfo` does under the static `ModelContextPolicy` contributions of the built-ins and host plugins. */
export async function modelCatalog(kernel: Kernel, models: Models): Promise<ModelCatalogView> {
  const generation = kernel.host.current().catalog;
  const policies = staticPolicies(kernel);
  const cached = pluginState(kernel).verdicts;

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

/** Returns one catalog model as `ModelInfo`, or null when the catalog has none: `thinking` from ai's `getSupportedThinkingLevels` (§38i), `fast` its fast sibling, and `compactAt` 80 % of the window. A `ModelContextPolicy` from `runtime`'s registry, else the host's static ones, overrides the window and threshold. */
export async function modelInfo(
  kernel: Kernel,
  models: Models,
  ref: ModelRef,
  runtime?: PluginRuntime,
): Promise<ModelInfo | null> {
  const model = models.getModel(ref.provider, ref.id);

  if (model === undefined) return null;

  const policy =
    runtime === undefined
      ? staticPolicies(kernel).get(keyOf(ref))
      : runtime.registries.modelContext
          .list()
          .findLast((entry) => keyOf(entry.model) === keyOf(ref));

  return projectModel(models, model, policy);
}

/** Returns one login attempt: iterating `steps()` starts `models.login` and yields its events and prompts as steps (§38a, §38b); the iterator's `return()` cancels it. `answer` resolves the pending prompt and throws `invalid` when none is pending or a `choose` gets an unknown id. A finished login drops the cached verdict and bumps the catalog generation. */
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
          pluginState(kernel).verdicts.delete(input.provider);
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

/** Sends one provider request and bumps the catalog generation when the provider's account limits changed, whether it resolved or threw. Every request core sends to a provider goes through it. */
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

/** Returns the model used when nothing is chosen: the stored default while the catalog has it, else the first base model of the first configured provider; null when none is configured. */
export async function defaultModel(kernel: Kernel, models: Models): Promise<ModelRef | null> {
  const stored = await readKv(kernel, DEFAULT_MODEL);

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

/** Returns the static `ModelContextPolicy` contributions by `<provider>/<id>`, a later entry winning. */
function staticPolicies(kernel: Kernel): ReadonlyMap<string, ModelContextPolicy> {
  const policies = new Map<string, ModelContextPolicy>();

  for (const plugin of [...kernel.builtins, ...kernel.hostPlugins])
    for (const policy of plugin.contribute?.modelContext ?? [])
      policies.set(keyOf(policy.model), policy);

  return policies;
}

/** Returns a provider's credential state: `missing`, `failed` when the check rejects, else the cached verdict or `configured`. */
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

function methodsOf(provider: Provider): readonly LoginMethod[] {
  const methods: LoginMethod[] = [];

  if (provider.auth.oauth !== undefined) methods.push({ kind: "oauth" });

  if (provider.auth.apiKey?.login !== undefined) methods.push({ kind: "key" });

  return methods;
}

/** Returns a provider's account limits as its catalog row shows them (§38c). */
function limitsOf(models: Models, provider: string): ProviderRow["limits"] {
  return (models.getAccountLimits(provider)?.windows ?? []).map((window) => ({
    label: window.id,
    used: window.usedPercent,
    limit: 100,
    resetsAt: window.resetsAt ?? null,
  }));
}

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

function promptStep(prompt: AuthPrompt): LoginStep {
  if (prompt.type === "select")
    return {
      kind: "choose",
      message: prompt.message,
      options: prompt.options.map((option) => ({ id: option.id, label: option.label })),
    };

  return { kind: "paste", message: prompt.message, secret: prompt.type === "secret" };
}

function keyOf(ref: Pick<ModelRef, "provider" | "id">): string {
  return `${ref.provider}/${ref.id}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a configuration resolves against: the agents and setting definitions a session's plugins contribute. */
export type Contributions = {
  readonly agents: readonly Agent[];
  readonly settings: readonly SettingDefinition[];
};

type Refusal = Exclude<ConfigureOutcome, { readonly kind: "configured" }>;

/** Returns the configuration resolver (`kernel.resolveConfiguration`). An exact `Configuration` is checked, never re-resolved: its model, its agent and its `settingsVersion` must still hold. A patch resolves field by field over `selected`: agent, then model (patch, selected, the agent's pin, `defaultModel`), thinking (the model's default, or a kept level clamped by ai's `clampThinkingLevel`), and settings merged per key and checked against the session-scope definitions. */
export function createConfigurationResolver(kernel: Kernel, models: Models): ConfigurationResolver {
  return async ({ selected, patch, contributions }) => {
    const version = await settingsVersion(contributions.settings);
    const { agents } = contributions;

    if (patch !== null && "kind" in patch) {
      if (models.getModel(patch.model.provider, patch.model.id) === undefined)
        return { kind: "unknown-model", model: patch.model };

      if (patch.agent !== null && !agents.some((agent) => agent.id === patch.agent))
        return { kind: "unknown-agent", agent: patch.agent };

      if (patch.settingsVersion !== version)
        return invalid([
          issue(["settingsVersion"], "The host's session settings changed since it was resolved."),
        ]);

      return patch;
    }

    return resolvePatch(kernel, models, {
      selected,
      patch: patch ?? {},
      version,
      contributions,
    });
  };
}

/** Returns the version of a session's setting schemas: `objectId` of the session-scope definitions' `{ id, schema }` sorted by id. */
export function settingsVersion(settings: readonly SettingDefinition[]): Promise<string> {
  const schemas = sessionScoped(settings)
    .flatMap((definition) => {
      try {
        return [{ id: definition.id, schema: jsonSchemaOf(definition.schema, "output") }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  return objectId(schemas);
}

async function resolvePatch(
  kernel: Kernel,
  models: Models,
  input: {
    readonly selected: Configuration | null;
    readonly patch: ConfigurationPatch;
    readonly version: string;
    readonly contributions: Contributions;
  },
): Promise<Configuration | Refusal> {
  const { selected, patch } = input;
  const agent = patch.agent === undefined ? (selected?.agent ?? null) : patch.agent;
  const pinned =
    agent === null ? undefined : input.contributions.agents.find((entry) => entry.id === agent);

  if (agent !== null && pinned === undefined) return { kind: "unknown-agent", agent };

  const ref =
    patch.model ?? selected?.model ?? pinned?.model ?? (await defaultModel(kernel, models));

  if (ref === null)
    return invalid([issue(["model"], "No model was chosen and no provider is configured.")]);
  const model = models.getModel(ref.provider, ref.id);

  if (model === undefined) return { kind: "unknown-model", model: ref };
  const issues: ValidationIssue[] = [];
  const thinking = thinkingOf(model, patch.thinking, selected?.thinking);

  if (thinking === null) issues.push(issue(["thinking"], `${ref.id} does not accept that level.`));
  const settings: Record<string, Json> = { ...selected?.settings, ...patch.settings };
  const definitions = sessionScoped(input.contributions.settings);

  for (const [id, value] of Object.entries(settings)) {
    const definition = definitions.find((entry) => entry.id === id);

    if (definition === undefined) {
      issues.push(issue(["settings", id], `No session setting is named ${id}.`));
      continue;
    }

    const checked = await check(definition.schema, value);

    if (checked.kind === "invalid")
      issues.push(
        ...checked.issues.map((found) => ({ ...found, path: ["settings", id, ...found.path] })),
      );
  }

  if (thinking === null || issues.length > 0) return invalid(issues);

  return {
    kind: "exact",
    model: ref,
    thinking,
    agent,
    settings,
    settingsVersion: input.version,
  };
}

/** Returns the thinking level a resolution lands on, or null when the model does not accept the level given. */
function thinkingOf(
  model: Model<Api>,
  given: Thinking | null | undefined,
  kept: Thinking | undefined,
): Thinking | null {
  const accepted: readonly Thinking[] = [
    "off",
    ...getSupportedThinkingLevels(model).filter((level) => level !== "off"),
  ];

  if (given !== undefined && given !== null) return accepted.includes(given) ? given : null;

  if (given === undefined && kept !== undefined)
    return accepted.includes(kept) ? kept : clampThinkingLevel(model, kept);

  return model.reasoning ? (accepted.find((level) => level !== "off") ?? "off") : "off";
}

function sessionScoped(settings: readonly SettingDefinition[]): readonly SettingDefinition[] {
  return settings.filter((definition) => definition.scope === "session");
}

/** Returns a session runtime's contributions. */
export function contributionsOf(runtime: PluginRuntime): Contributions {
  return { agents: runtime.registries.agents.list(), settings: runtime.registries.settings.list() };
}

/** Returns the static contributions of `kernel.builtins` then `kernel.hostPlugins`, so a session's configuration resolves before it has a runtime. */
export function staticContributions(kernel: Kernel): Contributions {
  const plugins = [...kernel.builtins, ...kernel.hostPlugins];

  return {
    agents: plugins.flatMap((plugin) => plugin.contribute?.agents ?? []),
    settings: plugins.flatMap((plugin) => plugin.contribute?.settings ?? []),
  };
}

function invalid(issues: readonly ValidationIssue[]): Refusal {
  return { kind: "invalid", issues };
}

function issue(path: readonly (string | number)[], message: string): ValidationIssue {
  return { severity: "error", path, message };
}
