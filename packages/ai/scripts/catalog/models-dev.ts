/** The models.dev catalog: its validated shape, the model fields every provider reads, and the per-model metadata later passes apply. */
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { Api, Model, ModelCost } from "../../src/types.ts";
import {
  ModelsDevReasoningOptionSchema,
  type ModelsDevReasoningOption,
} from "../models-dev-reasoning-options.ts";

const optionalNumber = Type.Optional(Type.Number());

const CostRatesFields = {
  input: optionalNumber,
  output: optionalNumber,
  cache_read: optionalNumber,
  cache_write: optionalNumber,
};

const ModelsDevModelSchema = Type.Object({
  id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  tool_call: Type.Optional(Type.Boolean()),
  structured_output: Type.Optional(Type.Boolean()),
  reasoning: Type.Optional(Type.Boolean()),
  reasoning_options: Type.Optional(Type.Array(ModelsDevReasoningOptionSchema)),
  experimental: Type.Optional(
    Type.Object({ modes: Type.Optional(Type.Object({ fast: Type.Optional(Type.Unknown()) })) }),
  ),
  status: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Object({ context: optionalNumber, output: optionalNumber })),
  cost: Type.Optional(
    Type.Object({
      ...CostRatesFields,
      tiers: Type.Optional(
        Type.Array(
          Type.Object({
            ...CostRatesFields,
            tier: Type.Optional(
              Type.Object({ type: Type.Optional(Type.String()), size: optionalNumber }),
            ),
          }),
        ),
      ),
    }),
  ),
  modalities: Type.Optional(
    Type.Object({
      input: Type.Optional(Type.Array(Type.String())),
      output: Type.Optional(Type.Array(Type.String())),
    }),
  ),
  provider: Type.Optional(
    Type.Object({ npm: Type.Optional(Type.Union([Type.String(), Type.Null()])) }),
  ),
});

const ModelsDevProviderSchema = Type.Object({
  models: Type.Optional(Type.Record(Type.String(), ModelsDevModelSchema)),
});

const ModelsDevCatalogSchema = Type.Record(Type.String(), ModelsDevProviderSchema);

export type ModelsDevModel = Static<typeof ModelsDevModelSchema>;

export type ModelsDevProvider = Static<typeof ModelsDevProviderSchema>;

export type ModelsDevCatalog = Static<typeof ModelsDevCatalogSchema>;

/** Fetches models.dev's catalog and checks every provider and model against the fields the generator reads. */
export async function fetchModelsDevCatalog(): Promise<ModelsDevCatalog> {
  const response = await fetch("https://models.dev/api.json");

  if (!response.ok) throw new Error(`models.dev API returned ${response.status}`);
  const data: unknown = await response.json();

  if (!Value.Check(ModelsDevCatalogSchema, data)) {
    throw new Error("models.dev API returned an unexpected catalog");
  }

  return data;
}

/** A model's input modalities: images when models.dev lists them, text always. */
export function modelInput(model: ModelsDevModel): Model<Api>["input"] {
  return model.modalities?.input?.includes("image") ? ["text", "image"] : ["text"];
}

/** A models.dev price without context tiers; missing rates are zero. */
export function flatCost(cost: ModelsDevModel["cost"]): ModelCost {
  return {
    input: cost?.input || 0,
    output: cost?.output || 0,
    cacheRead: cost?.cache_read || 0,
    cacheWrite: cost?.cache_write || 0,
  };
}

/** A models.dev price with its context tiers; missing rates are zero. */
export function modelsDevCost(cost: ModelsDevModel["cost"]): ModelCost {
  const tiers = cost?.tiers?.flatMap((tier) => {
    const context = tier.tier;

    if (context?.type !== "context" || context.size === undefined) return [];

    return [
      {
        inputTokensAbove: context.size,
        input: tier.input || 0,
        output: tier.output || 0,
        cacheRead: tier.cache_read || 0,
        cacheWrite: tier.cache_write || 0,
      },
    ];
  });

  const modelCost = flatCost(cost);

  if (tiers && tiers.length > 0) modelCost.tiers = tiers;

  return modelCost;
}

/** The catalog entry most providers build from a models.dev model: flat cost and 4096-token fallbacks. */
export function modelsDevModel(
  id: string,
  model: ModelsDevModel,
  api: Api,
  provider: string,
  baseUrl: string,
): Model<Api> {
  return {
    id,
    name: model.name || id,
    api,
    provider,
    baseUrl,
    reasoning: model.reasoning === true,
    input: modelInput(model),
    cost: flatCost(model.cost),
    contextWindow: model.limit?.context || 4096,
    maxTokens: model.limit?.output || 4096,
  };
}

/**
 * models.dev's reasoning options and fast mode for each catalog model, under `provider:id`. The loaders record
 * them from the source models they read; the thinking and compat passes read them back.
 */
export class ModelsDevMetadata {
  readonly #reasoningOptions = new Map<string, ModelsDevReasoningOption[]>();
  readonly #modes = new Map<string, NonNullable<Model<Api>["modes"]>>();

  /** Keeps a source model's reasoning options and fast mode under `provider:id`. */
  record(provider: string, id: string, sourceModel: ModelsDevModel): void {
    const key = `${provider}:${id}`;

    if (sourceModel.reasoning_options !== undefined) {
      this.#reasoningOptions.set(key, sourceModel.reasoning_options);
    }

    if (sourceModel.experimental?.modes?.fast !== undefined) this.#modes.set(key, ["fast"]);
  }

  /** The reasoning options recorded under `provider:id`. */
  findReasoningOptions(key: string): ModelsDevReasoningOption[] | undefined {
    return this.#reasoningOptions.get(key);
  }

  /** The modes recorded under `provider:id`. */
  findModes(key: string): NonNullable<Model<Api>["modes"]> | undefined {
    return this.#modes.get(key);
  }
}
