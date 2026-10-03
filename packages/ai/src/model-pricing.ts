/**
 * Service-tier and fast-mode pricing multipliers.
 *
 * Based on https://github.com/earendil-works/pi/blob/a6ca861024ddc1492af14e5386a3d3e2bfe8ab64/packages/ai/src/api/openai-responses.ts
 * Synced with pi a6ca86102.
 */
import type { Api, Model, Usage } from "./types.ts";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

export const ANTHROPIC_FAST_MODE_COST_MULTIPLIER = 2;

/** Shared by request accounting and model-selection previews. GPT-6 reports Fast mode as a `fast` tier the SDK types do not list. */
export function getServiceTierCostMultiplier(
  model: Pick<Model<Api>, "id">,
  serviceTier: ResponseCreateParamsStreaming["service_tier"] | "fast",
): number {
  switch (serviceTier) {
    case "flex":
      return 0.5;
    case "priority":
    case "fast":
      return model.id === "gpt-5.5" ? 2.5 : 2;
    default:
      return 1;
  }
}

export function applyServiceTierPricing(
  usage: Usage,
  serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
  model: Pick<Model<Api>, "id">,
) {
  const multiplier = getServiceTierCostMultiplier(model, serviceTier ?? undefined);

  if (multiplier === 1) return;

  usage.cost.input *= multiplier;
  usage.cost.output *= multiplier;
  usage.cost.cacheRead *= multiplier;
  usage.cost.cacheWrite *= multiplier;
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}

/** An unknown provider's premium must not be presented as a standard rate. */
export function getFastModeCostMultiplier(model: Model<Api>): number | undefined {
  switch (model.api) {
    case "openai-responses":
    case "openai-codex-responses":
      return getServiceTierCostMultiplier(model, "priority");
    case "anthropic-messages":
      return model.provider === "anthropic" ? ANTHROPIC_FAST_MODE_COST_MULTIPLIER : undefined;
    default:
      return undefined;
  }
}
