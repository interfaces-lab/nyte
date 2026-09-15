/**
 * The desktop's provider catalog: the same explicit factories and the same
 * `~/.nyte` credential and model stores the TUI uses, so a login made in either
 * client is a login in both. Browser-first OAuth: the desktop opens the URL,
 * shows a device code when the provider hands one out, and refuses flows that
 * would need a terminal prompt.
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
  LoginOutcome,
  LoginProgress,
  ProviderStatus,
  SignInMethod,
} from "../shared/ipc.ts";
import { safeExternalUrl } from "./external-url.ts";
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
  readonly available: boolean;
}

/**
 * One pass over providers and models: connection, the user's switches, and
 * the default a new chat starts with. The picker rule lives here and nowhere
 * else: a model is listed when its provider is on and connected, the current
 * credential permits it, and the model itself is not hidden.
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
  const availableKeys = new Set(
    (await models.getAvailable()).map((model) => `${model.provider}/${model.id}`),
  );
  const entries = models.getModels().map((model): Entry => {
    const key = `${model.provider}/${model.id}`;
    const available = availableKeys.has(key);
    const hidden = preferences.providers[model.provider]?.hiddenModels?.includes(model.id) ?? false;
    return {
      model,
      available,
      option: {
        key,
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
        listed: available && listedProviders.has(model.provider) && !hidden,
      },
    };
  });
  const providerIds = providers.map((provider) => provider.id);
  const listed = entries.filter((entry) => entry.option.listed);
  const available = entries.filter((entry) => entry.available);
  const chosen = preferences.defaults.model;
  // Prefer a listed choice, but keep hidden or disabled settings usable as a
  // last resort. With no available models, a baked placeholder keeps Settings
  // reachable for sign-in; it is not listed as a selectable model.
  const fallback =
    listed.find(
      (entry) => entry.model.provider === chosen?.provider && entry.model.id === chosen.id,
    ) ??
    firstPreferred(listed, providerIds) ??
    firstPreferred(available, providerIds) ??
    firstPreferred(entries, providerIds);
  if (fallback === undefined) throw new Error("No models in the provider catalog");
  return {
    defaultModel: fallback.model,
    catalog: {
      source: "local",
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

/** What the desktop can do for a provider's login flow while it runs. */
interface LoginHost {
  /** Aborting ends the provider's flow, including any device-code polling. */
  readonly signal: AbortSignal;
  openExternal(url: string): void;
  report(progress: LoginProgress): void;
}

const BROWSER_OPTION_ID = "browser";

/** Only web links leave the app; a provider cannot make the desktop open anything else. */
function webUrl(url: string): string | undefined {
  try {
    return safeExternalUrl(url);
  } catch {
    return undefined;
  }
}

/**
 * Sign a provider in. A pasted key answers the provider's one secret prompt;
 * the browser flow answers a selection that offers "browser" and holds the
 * manual-code path open until the callback lands. A device code is shown to
 * the user while the provider polls; every other prompt would need a
 * terminal, which the desktop does not have. A saved credential is reported
 * apart from the model refresh that follows it, so a discovery failure never
 * reads as a failed sign-in.
 */
export async function login(
  models: Models,
  providerId: string,
  method: { kind: "browser" } | { kind: "api_key"; key: string },
  host: LoginHost,
): Promise<LoginOutcome> {
  try {
    await models.login(providerId, method.kind === "api_key" ? "api_key" : "oauth", {
      signal: host.signal,
      prompt: (prompt) => {
        if (prompt.type === "secret" && method.kind === "api_key")
          return Promise.resolve(method.key);
        if (
          prompt.type === "select" &&
          method.kind === "browser" &&
          prompt.options.some((option) => option.id === BROWSER_OPTION_ID)
        )
          return Promise.resolve(BROWSER_OPTION_ID);
        if (prompt.type === "manual_code") {
          // Held open until the callback lands or the desktop gives up: a flow
          // that passes no prompt signal still releases on cancel or shutdown.
          const release =
            prompt.signal === undefined
              ? host.signal
              : AbortSignal.any([host.signal, prompt.signal]);
          return new Promise<string>((_resolve, reject) => {
            const cancel = (): void => reject(new Error("Browser login finished"));
            if (release.aborted) cancel();
            else release.addEventListener("abort", cancel, { once: true });
          });
        }
        return Promise.reject(
          new Error("Couldn't finish signing in here. Run `nyte login` in a terminal."),
        );
      },
      notify: (event) => {
        if (host.signal.aborted) return;
        switch (event.type) {
          case "auth_url": {
            const url = webUrl(event.url);
            if (url === undefined)
              host.report({
                kind: "message",
                message: "The provider sent a sign-in link that isn't a web address.",
              });
            else host.openExternal(url);
            return;
          }
          case "device_code":
            host.report({
              kind: "device_code",
              userCode: event.userCode,
              verificationUri: event.verificationUri,
              expiresInSeconds: event.expiresInSeconds,
              instructions: event.instructions,
            });
            return;
          case "progress":
          case "info":
            host.report({ kind: "message", message: event.message });
            return;
          default: {
            const _exhaustive: never = event;
            return _exhaustive;
          }
        }
      },
    });
  } catch (error) {
    // The flow's own rejection is noise once the user has cancelled.
    if (host.signal.aborted) return { kind: "cancelled" };
    throw error;
  }
  // The credential is saved; discovery is a separate step that can fail on
  // its own. Forced so a provider whose list depends on the account fetches now.
  const refreshed = await models.refresh({
    providers: [providerId],
    force: true,
    signal: host.signal,
  });
  return { kind: "connected", catalogRefreshed: !refreshed.aborted && refreshed.errors.size === 0 };
}
