/**
 * The provider catalog a host answers from, and the user-scoped model
 * preferences it applies: which providers and models are enabled, and what a
 * new chat starts with. Preferences live in `~/.nyte` beside the credential and
 * model stores, so every host on the machine reads the same choices.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  clampThinkingLevel,
  defaultModelPerProvider,
  fastModelId,
  getSupportedThinkingLevels,
} from "@nyte-ai/ai";
import type { Api, Model, Models } from "@nyte-ai/ai";
import type { ModelCatalog } from "@nyte-ai/core";
import { schemas } from "@nyte-ai/protocol";
import type {
  CatalogModel,
  PreferenceChange,
  ProviderCatalog,
  ProviderStatus,
  SignInMethod,
} from "@nyte-ai/protocol";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { nyteHome } from "./paths.ts";

const DEFAULT_THINKING_LEVEL = "medium";

const preferencesType = Type.Object({
  providers: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Object({
        enabled: Type.Optional(Type.Boolean()),
        hiddenModels: Type.Optional(Type.Array(Type.String())),
      }),
    ),
  ),
  defaults: Type.Optional(
    Type.Object({
      model: Type.Optional(Type.Object({ provider: Type.String(), id: Type.String() })),
      thinkingLevel: Type.Optional(schemas.ThinkingLevel),
    }),
  ),
});

const preferencesFile = Compile(preferencesType);

export type ModelPreferences = Required<Static<typeof preferencesType>>;

export const EMPTY_MODEL_PREFERENCES: ModelPreferences = {
  providers: {},
  defaults: {},
};

export function parseModelPreferences(text: string): ModelPreferences {
  try {
    const { providers = {}, defaults = {} } = preferencesFile.Parse(JSON.parse(text));

    return { providers, defaults };
  } catch {
    return EMPTY_MODEL_PREFERENCES;
  }
}

export function applyPreferenceChange(
  preferences: ModelPreferences,
  change: PreferenceChange,
): ModelPreferences {
  switch (change.kind) {
    case "provider": {
      const current = preferences.providers[change.provider] ?? {};

      return {
        ...preferences,
        providers: {
          ...preferences.providers,
          [change.provider]: { ...current, enabled: change.enabled },
        },
      };
    }

    case "models": {
      const current = preferences.providers[change.provider] ?? {};
      const changed = new Set(change.ids);
      const hiddenModels = (current.hiddenModels ?? []).filter((id) => !changed.has(id));

      if (change.hidden) hiddenModels.push(...changed);

      return {
        ...preferences,
        providers: { ...preferences.providers, [change.provider]: { ...current, hiddenModels } },
      };
    }

    case "defaults":
      return {
        ...preferences,
        defaults: {
          model: change.model ?? preferences.defaults.model,
          thinkingLevel: change.thinkingLevel ?? preferences.defaults.thinkingLevel,
        },
      };
    default: {
      const _exhaustive: never = change;

      return _exhaustive;
    }
  }
}

/** Serializes read-modify-write so two callers cannot lose each other's changes. */
export class ModelPreferencesStore {
  private readonly path: string;
  private tail: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  read(): Promise<ModelPreferences> {
    return this.serialized(() => this.load());
  }

  update(change: PreferenceChange): Promise<ModelPreferences> {
    return this.serialized(async () => {
      const next = applyPreferenceChange(await this.load(), change);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await writeFile(this.path, `${JSON.stringify(next, null, 2)}\n`);

      return next;
    });
  }

  private async load(): Promise<ModelPreferences> {
    try {
      return parseModelPreferences(await readFile(this.path, "utf8"));
    } catch {
      return EMPTY_MODEL_PREFERENCES;
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }
}

export function createModelPreferencesStore(): ModelPreferencesStore {
  return new ModelPreferencesStore(join(nyteHome(), "model-preferences.json"));
}

function isModelEnabled(
  model: Pick<Model<Api>, "provider" | "id">,
  preferences: ModelPreferences,
): boolean {
  const provider = preferences.providers[model.provider];

  return provider?.enabled !== false && !provider?.hiddenModels?.includes(model.id);
}

export function createModelCatalog(
  models: ModelCatalog,
  preferences: ModelPreferencesStore,
): ModelCatalog {
  return {
    getModels: models.getModels.bind(models),
    getModel: models.getModel.bind(models),
    verifyAuth: models.verifyAuth?.bind(models),
    async getAvailable(provider, options) {
      const available = await models.getAvailable(provider, options);
      const current = await preferences.read();

      // A fast sibling follows its base's switch.
      return available.filter((model) =>
        isModelEnabled({ provider: model.provider, id: model.variant?.base ?? model.id }, current),
      );
    },
  };
}

export interface ResolvedCatalog {
  readonly catalog: ProviderCatalog;
  /** The catalog's default as the SDK needs it, for composition. */
  readonly defaultModel?: Model<Api>;
}

interface Entry {
  readonly model: Model<Api>;
  readonly option: CatalogModel;
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

  const availableKeys = new Set(
    (await models.getAvailable()).map((model) => `${model.provider}/${model.id}`),
  );

  // A fast sibling is not a row: its base row carries it, and selecting fast selects it.
  const entries = models
    .getModels()
    .filter((model) => model.variant === undefined)
    .map((model): Entry => {
      const key = `${model.provider}/${model.id}`;
      const available = availableKeys.has(key);
      const hidden =
        preferences.providers[model.provider]?.hiddenModels?.includes(model.id) ?? false;
      const fast = models.getModel(model.provider, fastModelId(model.id));

      return {
        model,
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
          fastMode:
            fast?.variant?.base === model.id
              ? { kind: "available", id: fast.id }
              : { kind: "unavailable" },
          thinkingLevels: getSupportedThinkingLevels(model),
          hidden,
          listed: available && isModelEnabled(model, preferences),
        },
      };
    });

  const providerIds = providers.map((provider) => provider.id);
  const listed = entries.filter((entry) => entry.option.listed);
  const enabled = entries.filter((entry) => isModelEnabled(entry.model, preferences));
  const chosen = preferences.defaults.model;
  const chosenModel =
    chosen === undefined ? undefined : models.getModel(chosen.provider, chosen.id);

  // A chosen fast sibling stands while its base row is listed.
  const chosenBase =
    chosenModel?.variant === undefined
      ? chosenModel
      : models.getModel(chosenModel.provider, chosenModel.variant.base);

  const sameModel = (left: Model<Api>, right: Model<Api> | undefined) =>
    right !== undefined && left.provider === right.provider && left.id === right.id;

  const fallback =
    listed.find((entry) => sameModel(entry.model, chosenBase)) ??
    firstPreferred(listed, providerIds) ??
    firstPreferred(enabled, providerIds);

  const defaultModel =
    fallback !== undefined && chosenModel !== undefined && sameModel(fallback.model, chosenBase)
      ? chosenModel
      : fallback?.model;

  return {
    defaultModel,
    catalog: {
      source: "local",
      providers,
      models: entries.map((entry) => entry.option),
      defaults:
        defaultModel === undefined
          ? undefined
          : {
              model: { provider: defaultModel.provider, id: defaultModel.id },
              thinkingLevel: clampThinkingLevel(
                defaultModel,
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
