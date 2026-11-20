import type { ModelInfo, Thinking } from "@nyte-ai/sdk";
import { MODEL_THINKING_LEVELS } from "@nyte-ai/schema/model";

export type ThinkingLevel = Thinking;

export const THINKING_LABELS: Readonly<Record<ThinkingLevel, string>> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export function thinkingLevelsFor(
  option: Pick<ModelInfo, "thinking"> | undefined,
): readonly ThinkingLevel[] {
  const supported = option?.thinking ?? (["off"] as const);
  const ordered = MODEL_THINKING_LEVELS.filter((level) => supported.includes(level));

  return ordered.length === 0 ? ["off"] : ordered;
}

export function supportedThinkingLevel(
  option: Pick<ModelInfo, "thinking" | "defaultThinking"> | undefined,
  requested: ThinkingLevel | undefined,
): ThinkingLevel {
  const levels = thinkingLevelsFor(option);

  if (requested !== undefined && levels.includes(requested)) return requested;

  if (option !== undefined && levels.includes(option.defaultThinking))
    return option.defaultThinking;

  return levels[0] ?? "off";
}
