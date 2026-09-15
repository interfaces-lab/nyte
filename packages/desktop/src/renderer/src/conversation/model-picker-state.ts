/**
 * Pure rules the model picker and Settings › Models share. The host already
 * decided which models are listed; this file only formats and groups.
 */
import type { RunConfig, ThinkingLevel } from "@nyte-ai/core";
import { MODEL_THINKING_LEVELS } from "@nyte-ai/schema";
import type { DesktopCatalog, DesktopModelOption, ProviderStatus } from "../nyte.ts";

/** The catalog's name for a session's model; the raw id until the catalog loads. */
export function modelDisplayName(
  catalog: DesktopCatalog | undefined,
  model: RunConfig["model"],
): string | undefined {
  if (model === undefined) return undefined;
  const option = catalog?.models.find(
    (candidate) =>
      candidate.id === model.id &&
      (model.provider === undefined || candidate.provider === model.provider),
  );
  return option?.name ?? model.id;
}

export const THINKING_LABELS: Readonly<Record<ThinkingLevel, string>> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

/** 1,050,000 is "1M", not "1.1M": the label never promises more than the model has. */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${String(Math.floor(tokens / 100_000) / 10)}M`;
  return `${String(Math.round(tokens / 1_000))}K`;
}

/** "Free", or input and output dollars per million tokens: "$2.50 / $15". */
export function formatPricing(cost: DesktopModelOption["cost"]): string {
  if (cost.input === 0 && cost.output === 0) return "Free";
  const rate = (dollars: number): string =>
    Number.isInteger(dollars) ? `$${String(dollars)}` : `$${dollars.toFixed(2)}`;
  return `${rate(cost.input)} / ${rate(cost.output)}`;
}

export function thinkingLevelsFor(
  option: DesktopModelOption | undefined,
): readonly ThinkingLevel[] {
  const supported = option?.thinkingLevels ?? (["off"] as const);
  const ordered = MODEL_THINKING_LEVELS.filter((level) => supported.includes(level));
  return ordered.length === 0 ? ["off"] : ordered;
}

export function supportedThinkingLevel(
  option: DesktopModelOption | undefined,
  requested: ThinkingLevel | undefined,
): ThinkingLevel {
  const levels = thinkingLevelsFor(option);
  if (requested !== undefined && levels.includes(requested)) return requested;
  if (levels.includes("medium")) return "medium";
  return levels[0] ?? "off";
}

interface TriggerLabel {
  readonly name: string;
  /** Muted after the name: the reasoning level when the model has a choice, then Fast when on. */
  readonly detail: string | undefined;
}

export function modelTriggerLabel(
  option: DesktopModelOption | undefined,
  activeReasoning: ThinkingLevel | undefined,
  fastOn = false,
): TriggerLabel {
  if (option === undefined) return { name: "Choose a model", detail: undefined };
  const parts: string[] = [];
  if (
    activeReasoning !== undefined &&
    activeReasoning !== "off" &&
    thinkingLevelsFor(option).length > 1
  ) {
    parts.push(THINKING_LABELS[activeReasoning]);
  }
  if (fastOn) parts.push("Fast");
  return { name: option.name, detail: parts.length === 0 ? undefined : parts.join(" · ") };
}

interface PickerGroup {
  readonly provider: ProviderStatus;
  readonly options: readonly DesktopModelOption[];
}

/**
 * Listed models grouped in provider order, plus whatever the session already
 * runs on so the chip is never empty; the group's provider state explains
 * why an unlisted model is there.
 */
export function pickerGroups(
  catalog: DesktopCatalog,
  current: DesktopModelOption | undefined,
  search: string,
): PickerGroup[] {
  const needle = search.trim().toLowerCase();
  return catalog.providers.flatMap((provider) => {
    const options = catalog.models.filter(
      (option) =>
        option.provider === provider.id &&
        (option.listed || option.key === current?.key) &&
        `${option.name}\n${option.id}\n${provider.name}`.toLowerCase().includes(needle),
    );
    return options.length === 0 ? [] : [{ provider, options }];
  });
}
