import type { Api, Model } from "./types.ts";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

export const ANTHROPIC_FAST_MODE_COST_MULTIPLIER = 2;

/** Shared by request accounting and model-selection previews. */
export function getServiceTierCostMultiplier(
  model: Pick<Model<Api>, "id">,
  serviceTier: ResponseCreateParamsStreaming["service_tier"],
): number {
  switch (serviceTier) {
    case "flex":
      return 0.5;
    case "priority":
      return model.id === "gpt-5.5" ? 2.5 : 2;
    default:
      return 1;
  }
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
