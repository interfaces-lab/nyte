import type { ModelInfo, RunConfig } from "@nyte-ai/protocol";

export type ThinkingLevel = NonNullable<RunConfig["thinkingLevel"]>;

/**
 * Low → high, same order the host catalog uses. A model's list is the subset
 * it supports, so the slider filters instead of assuming a fixed set of stops.
 */
const THINKING_ORDER = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ThinkingLevel[];

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
  option: Pick<ModelInfo, "thinkingLevels"> | undefined,
): readonly ThinkingLevel[] {
  const supported = option?.thinkingLevels ?? (["off"] as const);
  const ordered = THINKING_ORDER.filter((level) => supported.includes(level));

  return ordered.length === 0 ? ["off"] : ordered;
}

export function supportedThinkingLevel(
  option: Pick<ModelInfo, "thinkingLevels"> | undefined,
  requested: ThinkingLevel | undefined,
): ThinkingLevel {
  const levels = thinkingLevelsFor(option);

  if (requested !== undefined && levels.includes(requested)) return requested;

  if (levels.includes("medium")) return "medium";

  return levels[0] ?? "off";
}

export function thinkingIndex(levels: readonly ThinkingLevel[], value: ThinkingLevel): number {
  const index = levels.indexOf(value);

  return index < 0 ? 0 : index;
}
