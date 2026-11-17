import type { ModelCatalogView, ModelInfo, ModelRef, Thinking } from "@nyte-ai/sdk";
import { selectedModes } from "@nyte-ai/schema";
import { THINKING_LEVELS } from "./constants.ts";

export { availableModes, modelWithModes, selectedModes } from "@nyte-ai/schema";

export function availableModels(catalog: ModelCatalogView): readonly ModelInfo[] {
  return catalog.providers.flatMap((provider) =>
    provider.credential === "configured" ||
    provider.credential === "verified" ||
    provider.credential === "unknown"
      ? provider.models
      : [],
  );
}

export function findModel(models: readonly ModelInfo[], ref: ModelRef): ModelInfo | undefined {
  return models.find((model) => selectedModes(model, ref) !== null);
}

export function modelId(ref: ModelRef): string {
  return `${ref.provider}/${ref.id}`;
}

export function clampThinking(model: ModelInfo, level: Thinking): Thinking {
  const rank = THINKING_LEVELS.findIndex((candidate) => candidate === level);

  return (
    model.thinking.findLast(
      (candidate) => THINKING_LEVELS.findIndex((known) => known === candidate) <= rank,
    ) ??
    model.thinking[0] ??
    "off"
  );
}
