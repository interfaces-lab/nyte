import type { ModelInfo, ModelRef, Thinking } from "@nyte-ai/sdk";
import { selectedModes } from "@nyte-ai/schema";
import { THINKING_LEVELS } from "./constants.ts";

export {
  availableModels,
  availableModes,
  enabledModels,
  modelWithModes,
  selectedModes,
} from "@nyte-ai/schema";

export function findModel(models: readonly ModelInfo[], ref: ModelRef): ModelInfo | undefined {
  return models.find((model) => selectedModes(model, ref) !== null);
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
