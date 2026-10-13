/**
 * Readings of the host's model catalog: the models a signed-in provider
 * serves, one model by its ref, and a thinking level a model accepts.
 */
import type { ModelCatalogView, ModelInfo, ModelRef, Thinking } from "@nyte-ai/sdk";
import { THINKING_LEVELS } from "./constants.ts";

/** Returns every model of a provider whose credential is configured or verified. */
export function availableModels(catalog: ModelCatalogView): readonly ModelInfo[] {
  return catalog.providers.flatMap((provider) =>
    provider.credential === "configured" || provider.credential === "verified"
      ? provider.models
      : [],
  );
}

/** Returns the model a ref names, a fast ref resolving to the base row that carries it. */
export function findModel(models: readonly ModelInfo[], ref: ModelRef): ModelInfo | undefined {
  return models.find(
    (model) =>
      (model.ref.provider === ref.provider && model.ref.id === ref.id) ||
      (model.fast?.provider === ref.provider && model.fast.id === ref.id),
  );
}

/** Returns `provider/id` for a ref: the id a choice, a flag and a notice spell. */
export function modelId(ref: ModelRef): string {
  return `${ref.provider}/${ref.id}`;
}

/** Returns the level a model accepts nearest at or below `level`, else its lowest. */
export function clampThinking(model: ModelInfo, level: Thinking): Thinking {
  const rank = THINKING_LEVELS.indexOf(level);

  return (
    model.thinking.findLast((candidate) => THINKING_LEVELS.indexOf(candidate) <= rank) ??
    model.thinking[0] ??
    "off"
  );
}
