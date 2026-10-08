import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { applyServiceTierPricing } from "../model-pricing.ts";
import { calculateCost } from "../models.ts";
import type { Api, JsonValue, Model, Usage } from "../types.ts";

const tokenCount = Type.Number({ minimum: 0 });

const compactResponse = Type.Object({
  output: Type.Array(Type.Object({ type: Type.String({ minLength: 1 }) }), { minItems: 1 }),
  service_tier: Type.Optional(
    Type.Union([
      Type.Literal("auto"),
      Type.Literal("default"),
      Type.Literal("flex"),
      Type.Literal("priority"),
      Type.Null(),
    ]),
  ),
  usage: Type.Optional(
    Type.Object({
      input_tokens: tokenCount,
      output_tokens: tokenCount,
      total_tokens: tokenCount,
      input_tokens_details: Type.Optional(
        Type.Object({
          cached_tokens: Type.Optional(tokenCount),
          cache_write_tokens: Type.Optional(tokenCount),
        }),
      ),
      output_tokens_details: Type.Optional(
        Type.Object({ reasoning_tokens: Type.Optional(tokenCount) }),
      ),
    }),
  ),
});

export interface OpenAICompactResult {
  /** The complete opaque window, replayed unchanged to the matching provider. */
  readonly data: JsonValue;
  readonly usage?: Usage;
}

/** Decode the JSON envelope; provider-owned item contents remain opaque. */
export async function readOpenAICompactResponse(
  response: Response,
  model: Model<Api>,
  requestedServiceTier?: ResponseCreateParamsStreaming["service_tier"],
): Promise<OpenAICompactResult> {
  const decoded: unknown = await response.json();

  if (!Value.Check(compactResponse, decoded)) {
    throw new Error("OpenAI compact response did not contain valid output items and usage");
  }

  // Response.json produced these JSON objects; validation establishes their item envelope.
  const data = decoded.output;

  if (decoded.usage === undefined) return { data };
  const cached = decoded.usage.input_tokens_details?.cached_tokens ?? 0;
  const written = decoded.usage.input_tokens_details?.cache_write_tokens ?? 0;

  const usage: Usage = {
    input: Math.max(0, decoded.usage.input_tokens - cached - written),
    output: decoded.usage.output_tokens,
    cacheRead: cached,
    cacheWrite: written,
    reasoning: decoded.usage.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: decoded.usage.total_tokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  calculateCost(model, usage);
  // The endpoint reports the tier it ran at; the request's stands in when it says nothing.
  applyServiceTierPricing(usage, decoded.service_tier ?? requestedServiceTier, model);

  return { data, usage };
}
