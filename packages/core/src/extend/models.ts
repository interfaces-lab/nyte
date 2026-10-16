import { SdkError } from "@nyte-ai/schema";
import type {
  Configuration,
  ConfigurationPatch,
  LoginMethod,
  ModelAccount,
  ModelCatalogView,
  ModelInfo,
  ModelRef,
  ProviderUsage,
  Thinking,
  ValidationIssue,
} from "@nyte-ai/schema";
import type {
  AccountLimitWindow,
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  Models,
  Provider,
} from "@nyte-ai/ai";
import type { Api, Model } from "@nyte-ai/schema/model";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@nyte-ai/ai/models";
import type { Login, ModelsApi } from "../contract/host.ts";
import type {
  ConfigurationResolver,
  Contributions,
  Kernel,
  PluginRuntime,
} from "../contract/kernel.ts";
import type { ModelContextPolicy, SettingDefinition } from "../contract/plugin.ts";
import type { Refusal } from "../engine/contributions.ts";
import { commit } from "../fold/commit.ts";
import { MODEL_PREFERENCE, readModelSelection } from "../store/model-state.ts";
import { put } from "../store/session.ts";
import { objectId } from "../util/content.ts";
import { closable } from "../util/iterable.ts";
import { check, convertJsonSchema } from "../util/json-schema.ts";
import { bumpGeneration } from "./registry.ts";

type LoginStep = Login["steps"] extends () => AsyncIterable<infer Step> ? Step : never;

type ProviderRow = ModelCatalogView["providers"][number];

interface Pending {
  readonly options: readonly string[] | null;
  resolve(value: string): void;
}

export function createModelsApi(kernel: Kernel, models: Models): ModelsApi {
  return {
    list: () => modelCatalog(kernel, models),
    accounts: async (provider) => (await models.listAccounts(provider)).map(projectAccount),
    async selectAccount(provider, account) {
      await models.selectAccount(provider, account);
      kernel.modelState.invalidate(provider);
      bumpGeneration(kernel);
      void kernel.modelState.refresh(models, provider).catch(() => undefined);
    },
    async usage() {
      const before = await models.listAccounts();
      const usage = await Promise.all(
        models.getProviders().map((provider) => {
          const active = before.find(
            (account) => account.providerId === provider.id && account.active,
          );

          return providerUsage(
            kernel,
            models,
            provider,
            active === undefined ? null : projectAccount(active),
          );
        }),
      );

      const after = await models.listAccounts();

      return usage.map((entry) => {
        const selected = after.find(
          (account) => account.providerId === entry.provider && account.active,
        );

        if (entry.account?.id === selected?.id) return entry;

        return {
          ...entry,
          account: selected === undefined ? null : projectAccount(selected),
          state: {
            kind: "unavailable",
            reason: "failed",
            message: "The active account changed. Reload usage.",
          },
        } satisfies ProviderUsage;
      });
    },
    async refresh(provider) {
      const [result] = await Promise.all([
        models.refresh({ providers: provider === undefined ? undefined : [provider] }),
        kernel.modelState.refresh(models, provider),
      ]);

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
          name: MODEL_PREFERENCE,
          target: await put(kernel.store, "kv", { provider: ref.provider, id: ref.id }),
        },
      ]);
      bumpGeneration(kernel);

      return { kind: "set" };
    },
    async verify(provider) {
      let verification: Awaited<ReturnType<Models["verifyAuth"]>>;

      try {
        verification = await kernel.modelState.verify(models, provider);
      } catch (error) {
        return { kind: "failed", reason: formatErrorMessage(error) };
      }

      if (verification.ok) {
        if (!verification.verified) return { kind: "unverified" };
        return { kind: "verified" };
      }

      return { kind: "failed", reason: verification.message };
    },
    login: (input) => createLogin(kernel, models, input),
    async logout(provider) {
      await models.logout(provider);
      kernel.modelState.invalidate(provider);
      bumpGeneration(kernel);
      void kernel.modelState.refresh(models, provider).catch(() => undefined);
    },
  };
}

async function modelCatalog(kernel: Kernel, models: Models): Promise<ModelCatalogView> {
  const generation = kernel.host.current().catalog;
  const policies = staticPolicies(kernel);
  const [preferred, credentials] = await Promise.all([
    readModelSelection(kernel.store),
    kernel.modelState.read(models),
  ]);
  const providers = models.getProviders().map((provider): ProviderRow => {
    const catalog = models.getModels(provider.id);
    const fast = new Map<string, ModelRef>();

    for (const model of catalog)
      if (model.variant?.mode === "fast" && !fast.has(model.variant.base))
        fast.set(model.variant.base, { provider: model.provider, id: model.id });

    return {
      id: provider.id,
      name: provider.name,
      credential: credentials.get(provider.id) ?? "unknown",
      methods: listLoginMethods(provider),
      limits: readProviderLimits(models, provider.id),
      models: catalog
        .filter((model) => model.variant === undefined)
        .map((model) =>
          projectModel(model, fast.get(model.id) ?? null, policies.get(formatModelKey(model))),
        ),
    };
  });
  const fallback =
    providers.find(
      (provider) =>
        (provider.credential === "configured" || provider.credential === "verified") &&
        provider.models.length > 0,
    )?.models[0]?.ref ?? null;

  return { generation, default: preferred ?? fallback, providers };
}

export function modelInfo(models: Models, ref: ModelRef, runtime: PluginRuntime): ModelInfo | null {
  const catalog = models.getModels(ref.provider);
  const model = catalog.find((entry) => entry.id === ref.id);

  if (model === undefined) return null;

  const policy = runtime.registries.modelContext
    .list()
    .findLast((entry) => formatModelKey(entry.model) === formatModelKey(ref));

  const fast = catalog.find(
    (entry) => entry.variant?.mode === "fast" && entry.variant.base === model.id,
  );

  return projectModel(
    model,
    fast === undefined ? null : { provider: fast.provider, id: fast.id },
    policy,
  );
}

export function createLogin(
  kernel: Kernel,
  models: Models,
  input: Parameters<ModelsApi["login"]>[0],
): Login {
  let pending: Pending | null = null;

  function steps(): AsyncIterable<LoginStep> {
    return closable(() => {
      const controller = new AbortController();
      const queue: LoginStep[] = [];
      let wake: (() => void) | null = null;

      const push = (step: LoginStep): void => {
        if (controller.signal.aborted) return;
        queue.push(step);
        wake?.();
        wake = null;
      };

      const interaction: AuthInteraction = {
        signal: controller.signal,
        browser: input.browser,
        notify: (event) => push(projectLoginStep(event)),
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
        .login(
          input.provider,
          input.method.kind === "key" ? "api_key" : "oauth",
          interaction,
          input.label,
        )
        .then(
          async () => {
            await models.refresh({ providers: [input.provider] }).catch(() => undefined);
            kernel.modelState.invalidate(input.provider);
            bumpGeneration(kernel);
            void kernel.modelState.refresh(models, input.provider).catch(() => undefined);
            push({ kind: "done" });
          },
          (error: unknown) => push({ kind: "failed", reason: formatErrorMessage(error) }),
        );

      async function* forward(): AsyncGenerator<LoginStep, void> {
        try {
          for (;;) {
            if (controller.signal.aborted) return;
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

      const iterator = forward();

      return {
        pull: () => iterator.next(),
        async close() {
          controller.abort();
          wake?.();
          wake = null;
          await iterator.return(undefined);
        },
      };
    });
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

export async function withLimits<T>(
  kernel: Kernel,
  models: Models,
  provider: string,
  send: () => Promise<T>,
): Promise<T> {
  const before = JSON.stringify(readProviderLimits(models, provider));

  try {
    return await send();
  } finally {
    if (JSON.stringify(readProviderLimits(models, provider)) !== before) bumpGeneration(kernel);
  }
}

async function defaultModel(kernel: Kernel, models: Models): Promise<ModelRef | null> {
  const stored = await readModelSelection(kernel.store);

  if (stored !== null) return stored;

  for (const provider of models.getProviders()) {
    const credential = await kernel.modelState.check(models, provider).catch(() => "failed");

    if (credential !== "configured" && credential !== "verified") continue;
    const base = models.getModels(provider.id).find((model) => model.variant === undefined);

    if (base !== undefined) return { provider: base.provider, id: base.id };
  }

  return null;
}

function projectModel(
  model: Model<Api>,
  fast: ModelRef | null,
  policy: ModelContextPolicy | undefined,
): ModelInfo {
  return {
    ref: { provider: model.provider, id: model.id },
    name: model.name,
    reasoning: model.reasoning,
    thinking: ["off", ...getSupportedThinkingLevels(model).filter((level) => level !== "off")],
    fast,
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

function staticPolicies(kernel: Kernel): ReadonlyMap<string, ModelContextPolicy> {
  const policies = new Map<string, ModelContextPolicy>();

  for (const plugin of [...kernel.plugins.builtins, ...kernel.plugins.host])
    for (const policy of plugin.contribute?.modelContext ?? [])
      policies.set(formatModelKey(policy.model), policy);

  return policies;
}

function listLoginMethods(provider: Provider): readonly LoginMethod[] {
  const methods: LoginMethod[] = [];

  if (provider.auth.oauth !== undefined) methods.push({ kind: "oauth" });

  if (provider.auth.apiKey?.login !== undefined) methods.push({ kind: "key" });

  return methods;
}

function readProviderLimits(models: Models, provider: string): ProviderRow["limits"] {
  return projectLimits(models.getAccountLimits(provider)?.windows ?? []);
}

function projectLimits(windows: readonly AccountLimitWindow[]): ProviderRow["limits"] {
  return windows.map((window) => ({
    label: window.label,
    used: window.usedPercent,
    limit: 100,
    resetsAt: window.resetsAt ?? null,
  }));
}

function projectAccount(
  account: Awaited<ReturnType<Models["listAccounts"]>>[number],
): ModelAccount {
  return {
    provider: account.providerId,
    id: account.id,
    label: account.label,
    method: account.type === "api_key" ? { kind: "key" } : { kind: "oauth" },
    active: account.active,
  };
}

async function providerUsage(
  kernel: Kernel,
  models: Models,
  provider: Provider,
  account: ModelAccount | null,
): Promise<ProviderUsage> {
  try {
    const result = await withLimits(kernel, models, provider.id, () =>
      models.fetchAccountLimits(provider.id),
    );

    return {
      provider: provider.id,
      name: provider.name,
      account,
      state:
        result.kind === "ready"
          ? {
              kind: "ready",
              limits: projectLimits(result.limits.windows),
              observedAt: result.limits.observedAt,
              stale: result.stale,
              error: result.error,
            }
          : result,
    };
  } catch (error) {
    return {
      provider: provider.id,
      name: provider.name,
      account,
      state: { kind: "unavailable", reason: "failed", message: formatErrorMessage(error) },
    };
  }
}

function projectLoginStep(event: AuthEvent): LoginStep {
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

function formatModelKey(ref: Pick<ModelRef, "provider" | "id">): string {
  return `${ref.provider}/${ref.id}`;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

export function settingsVersion(settings: readonly SettingDefinition[]): Promise<string> {
  const schemas = sessionScoped(settings)
    .flatMap((definition) => {
      try {
        return [{ id: definition.id, schema: convertJsonSchema(definition.schema, "output") }];
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
  const thinking = selectThinkingLevel(model, patch.thinking, selected?.thinking);

  if (thinking === null) issues.push(issue(["thinking"], `${ref.id} does not accept that level.`));
  const settings = { ...selected?.settings, ...patch.settings };
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

function selectThinkingLevel(
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

function invalid(issues: readonly ValidationIssue[]): Refusal {
  return { kind: "invalid", issues };
}

function issue(path: readonly (string | number)[], message: string): ValidationIssue {
  return { severity: "error", path, message };
}
