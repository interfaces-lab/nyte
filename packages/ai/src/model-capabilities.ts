/**
 * What a model supports and costs: API narrowing, pricing, and thinking levels.
 */
import { MODEL_THINKING_LEVELS } from "@nyte-ai/schema/model";
import type { Api, Model, ModelCostRates, ModelThinkingLevel, Usage } from "./types.ts";

/**
 * Runtime-checked narrowing for dynamically looked-up models:
 *
 * ```ts
 * const model = models.getModel("anthropic", "claude-opus-4-7");
 * if (model && hasApi(model, "anthropic-messages")) {
 *   // model: Model<"anthropic-messages">, stream options fully typed
 * }
 * ```
 */
export function hasApi<TApi extends Api>(model: Model<Api>, api: TApi): model is Model<TApi> {
  return model.api === api;
}

/** Fills `usage.cost` from the model's rates, using the tier the input size reaches. Anthropic charges 2x base input for 1h cache writes. */
export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
  const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  let rates: ModelCostRates = model.cost;
  let matchedThreshold = -1;

  for (const tier of model.cost.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
      rates = tier;
      matchedThreshold = tier.inputTokensAbove;
    }
  }

  const longWrite = usage.cacheWrite1h ?? 0;
  const shortWrite = usage.cacheWrite - longWrite;
  usage.cost.input = (rates.input / 1000000) * usage.input;
  usage.cost.output = (rates.output / 1000000) * usage.output;
  usage.cost.cacheRead = (rates.cacheRead / 1000000) * usage.cacheRead;
  usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1000000;
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;

  return usage.cost;
}

export function getSupportedThinkingLevels<TApi extends Api>(
  model: Model<TApi>,
): ModelThinkingLevel[] {
  if (!model.reasoning) return ["off"];

  return MODEL_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];

    if (mapped === null) return false;

    if (level === "xhigh" || level === "max") return mapped !== undefined;

    return true;
  });
}

export function clampThinkingLevel<TApi extends Api>(
  model: Model<TApi>,
  level: ModelThinkingLevel,
): ModelThinkingLevel {
  const availableLevels = getSupportedThinkingLevels(model);

  if (availableLevels.includes(level)) return level;

  const requestedIndex = MODEL_THINKING_LEVELS.findIndex((candidate) => candidate === level);

  if (requestedIndex === -1) return availableLevels[0] ?? "off";

  for (let i = requestedIndex; i < MODEL_THINKING_LEVELS.length; i++) {
    const candidate = MODEL_THINKING_LEVELS[i];

    if (availableLevels.includes(candidate)) return candidate;
  }

  for (let i = requestedIndex - 1; i >= 0; i--) {
    const candidate = MODEL_THINKING_LEVELS[i];

    if (availableLevels.includes(candidate)) return candidate;
  }

  return availableLevels[0] ?? "off";
}

/**
 * Check if two models are equal by comparing both their id and provider.
 * Returns false if either model is null or undefined.
 */
export function modelsAreEqual<TApi extends Api>(
  a: Model<TApi> | null | undefined,
  b: Model<TApi> | null | undefined,
): boolean {
  if (!a || !b) return false;

  return a.id === b.id && a.provider === b.provider;
}
