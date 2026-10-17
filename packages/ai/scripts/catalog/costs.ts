/** Prices the generator writes into catalogs where upstream metadata is missing or stale. */
import type { Api, Model, ModelCost } from "../../src/types.ts";

/** OpenAI bills input above this many tokens at the long-context tier. */
export const OPENAI_LONG_CONTEXT_INPUT_THRESHOLD = 272000;

/** Rounds a price to six decimals, the precision catalogs store. */
export function roundCost(value: number): number {
  return Number(value.toFixed(6));
}

/** Adds OpenAI's long-context tier: double input and cache prices, 1.5x output, above the threshold. */
export function withOpenAiLongContextPricing(cost: Model<Api>["cost"]): Model<Api>["cost"] {
  return {
    ...cost,
    tiers: [
      {
        inputTokensAbove: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
        input: roundCost(cost.input * 2),
        output: roundCost(cost.output * 1.5),
        cacheRead: roundCost(cost.cacheRead * 2),
        cacheWrite: roundCost(cost.cacheWrite * 2),
      },
    ],
  };
}

/**
 * OpenAI reduced GPT-5.6 Terra and Luna prices on 2026-07-30. These stay the
 * authoritative values until models.dev and passthrough catalogs catch up.
 * https://developers.openai.com/api/docs/pricing
 */
export const OPENAI_GPT_56_LUNA_STANDARD_COST: ModelCost = {
  input: 0.2,
  output: 1.2,
  cacheRead: 0.02,
  cacheWrite: 0.25,
};

export const OPENAI_GPT_56_TERRA_STANDARD_COST: ModelCost = {
  input: 2,
  output: 12,
  cacheRead: 0.2,
  cacheWrite: 2.5,
};

export const OPENAI_GPT_56_STANDARD_COSTS = new Map([
  ["gpt-5.6-luna", OPENAI_GPT_56_LUNA_STANDARD_COST],
  ["gpt-5.6-terra", OPENAI_GPT_56_TERRA_STANDARD_COST],
]);

export const OPENAI_GPT_6_ASTRA_STANDARD_COST: ModelCost = {
  input: 10,
  output: 50,
  cacheRead: 1,
  cacheWrite: 12.5,
};

export const KIMI_K3_MAX_TOKENS = 131072;

export const KIMI_K3_COST = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 0,
} as const;

/**
 * Kimi Coding is subscription-backed, so models.dev reports zero cost. The
 * equivalent Moonshot API rates estimate the value of subscription usage.
 */
export const KIMI_CODING_IMPLIED_COSTS = new Map<string, ModelCost>([
  ["k3", KIMI_K3_COST],
  ["kimi-for-coding", { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 }],
  ["kimi-for-coding-highspeed", { input: 1.9, output: 8, cacheRead: 0.38, cacheWrite: 0 }],
  ["kimi-k2-thinking", { input: 0.6, output: 2.5, cacheRead: 0.15, cacheWrite: 0 }],
]);
