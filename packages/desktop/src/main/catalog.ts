/**
 * The desktop's provider catalog: the same explicit factories and the same
 * `~/.nyte` credential and model stores the TUI uses, so a login made in either
 * client is a login in both. Browser-first OAuth: the desktop opens the URL
 * and refuses flows that would need a terminal prompt.
 */
import {
  clampThinkingLevel,
  defaultModelPerProvider,
  getSupportedThinkingLevels,
} from "@nyte-ai/ai";
import type { Api, Model, Models } from "@nyte-ai/ai";
import { fastModeSettingId } from "@nyte-ai/plugin/examples/fast-mode";
import type {
  DesktopCatalog,
  DesktopModelOption,
  ProviderStatus,
  SignInMethod,
} from "../shared/ipc.ts";
import type { ModelPreferences } from "./model-preferences.ts";

const DEFAULT_THINKING_LEVEL = "medium";

/** Restore persisted catalogs from disk. Boot must work offline. */
export async function loadPersistedCatalog(models: Models): Promise<void> {
  await models.refresh({
    providers: models.getProviders().map((provider) => provider.id),
    allowNetwork: false,
  });
}

export interface ResolvedCatalog {
  readonly catalog: DesktopCatalog;
  /** The catalog's default as the SDK needs it, for composition. */
  readonly defaultModel: Model<Api>;
}

interface Entry {
  readonly model: Model<Api>;
  readonly option: DesktopModelOption;
}

/**
 * One pass over providers and models: connection, the user's switches, and
 * the default a new chat starts with. The picker rule lives here and nowhere
 * else: a model is listed when its provider is on and connected and the model
 * itself is not hidden.
 */
export async function readCatalog(
  models: Models,
  preferences: ModelPreferences,
): Promise<ResolvedCatalog> {
  const providers = await Promise.all(
    models.getProviders().map(async (provider): Promise<ProviderStatus> => {
      const auth = await models.checkAuth(provider.id).catch(() => undefined);
      const signIn: SignInMethod[] = [];
      if (provider.auth.oauth !== undefined) {
        signIn.push({
          kind: "browser",
          label: provider.auth.oauth.loginLabel ?? "Sign in",
          subscription: provider.auth.oauth.name,
        });
      }
      if (provider.auth.apiKey?.login !== undefined) {
        signIn.push({ kind: "api_key", label: provider.auth.apiKey.name });
      }
      return {
        id: provider.id,
        name: provider.name,
        enabled: preferences.providers[provider.id]?.enabled !== false,
        connection:
          auth === undefined
            ? { kind: "disconnected" }
            : auth.type === "oauth"
              ? { kind: "oauth" }
              : { kind: "api_key", env: environmentVariable(auth.source) },
        signIn,
      };
    }),
  );
  const listedProviders = new Set(
    providers
      .filter((provider) => provider.enabled && provider.connection.kind !== "disconnected")
      .map((provider) => provider.id),
  );
  const entries = models.getModels().map((model): Entry => {
    const hidden = preferences.providers[model.provider]?.hiddenModels?.includes(model.id) ?? false;
    return {
      model,
      option: {
        key: `${model.provider}/${model.id}`,
        provider: model.provider,
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        cost: {
          input: model.cost.input,
          output: model.cost.output,
          cacheRead: model.cost.cacheRead,
          cacheWrite: model.cost.cacheWrite,
        },
        fastMode: model.modes?.includes("fast")
          ? { kind: "available", settingId: fastModeSettingId(model.provider) }
          : { kind: "unavailable" },
        thinkingLevels: getSupportedThinkingLevels(model),
        hidden,
        listed: listedProviders.has(model.provider) && !hidden,
      },
    };
  });
  const providerIds = providers.map((provider) => provider.id);
  const listed = entries.filter((entry) => entry.option.listed);
  const chosen = preferences.defaults.model;
  // The user's choice when it is listed; else the first listed provider's
  // preferred model; else, before any login, the first provider's.
  const fallback =
    listed.find(
      (entry) => entry.model.provider === chosen?.provider && entry.model.id === chosen.id,
    ) ??
    firstPreferred(listed, providerIds) ??
    firstPreferred(entries, providerIds);
  if (fallback === undefined) throw new Error("No models in the provider catalog");
  return {
    defaultModel: fallback.model,
    catalog: {
      providers,
      models: entries.map((entry) => entry.option),
      defaults: {
        model: { provider: fallback.model.provider, id: fallback.model.id },
        thinkingLevel: clampThinkingLevel(
          fallback.model,
          preferences.defaults.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
        ),
      },
    },
  };
}

/** Auth sources are either an environment variable name or a store description. */
function environmentVariable(source: string | undefined): string | undefined {
  return source !== undefined && /^[A-Z][A-Z0-9_]*$/.test(source) ? source : undefined;
}

function firstPreferred(
  entries: readonly Entry[],
  providerIds: readonly string[],
): Entry | undefined {
  for (const providerId of providerIds) {
    const own = entries.filter((entry) => entry.model.provider === providerId);
    const preferred = own.find((entry) => entry.model.id === defaultModelPerProvider[providerId]);
    const pick = preferred ?? own[0];
    if (pick !== undefined) return pick;
  }
  return undefined;
}

/**
 * Sign a provider in. A pasted key answers the provider's one secret prompt;
 * the browser flow answers selection prompts with "browser" and holds the
 * manual-code path open until the callback lands. Anything else would need a
 * terminal, which the desktop does not have.
 */
export async function login(
  models: Models,
  providerId: string,
  method: { kind: "browser" } | { kind: "api_key"; key: string },
  host: { openExternal(url: string): void; notifyStatus(message: string): void },
): Promise<void> {
  await models.login(providerId, method.kind === "api_key" ? "api_key" : "oauth", {
    prompt: (prompt) => {
      if (prompt.type === "secret" && method.kind === "api_key") return Promise.resolve(method.key);
      if (prompt.type === "select") return Promise.resolve("browser");
      if (prompt.type === "manual_code") {
        return new Promise<string>((_resolve, reject) => {
          const cancel = (): void => reject(new Error("Browser login finished"));
          if (prompt.signal?.aborted === true) cancel();
          else prompt.signal?.addEventListener("abort", cancel, { once: true });
        });
      }
      return Promise.reject(
        new Error("Couldn't finish signing in here. Run `nyte login` in a terminal."),
      );
    },
    notify: (event) => {
      if (event.type === "auth_url") host.openExternal(event.url);
      if (event.type === "progress" || event.type === "info") host.notifyStatus(event.message);
    },
  });
}
