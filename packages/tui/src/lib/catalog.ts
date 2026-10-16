import type { ModelCatalogView, ModelInfo, ModelRef, Thinking } from "@nyte-ai/sdk";
import { THINKING_LEVELS } from "./constants.ts";

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
  return models.find(
    (model) =>
      (model.ref.provider === ref.provider && model.ref.id === ref.id) ||
      (model.fast?.provider === ref.provider && model.fast.id === ref.id),
  );
}

export function modelId(ref: ModelRef): string {
  return `${ref.provider}/${ref.id}`;
}

export function clampThinking(model: ModelInfo, level: Thinking): Thinking {
  const rank = THINKING_LEVELS.indexOf(level);

  return (
    model.thinking.findLast((candidate) => THINKING_LEVELS.indexOf(candidate) <= rank) ??
    model.thinking[0] ??
    "off"
  );
}
