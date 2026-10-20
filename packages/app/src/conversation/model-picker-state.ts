import type { ModelRef } from "@nyte-ai/sdk";
import type { ModelThinkingLevel } from "@nyte-ai/schema/model";
import { MODEL_THINKING_LEVELS } from "@nyte-ai/schema/model";
import type { DesktopCatalog, DesktopModelOption, ProviderStatus } from "../catalog.ts";
import type { IconName } from "@nyte-ai/ui/icon";

export function selectedModelOption(
  options: readonly DesktopModelOption[],
  model: ModelRef | undefined,
): { readonly option: DesktopModelOption; readonly fast: boolean } | undefined {
  if (model === undefined) return undefined;

  for (const option of options) {
    if (option.provider !== model.provider) continue;

    if (option.id === model.id) return { option, fast: false };

    if (option.fastMode.kind === "available" && option.fastMode.id === model.id)
      return { option, fast: true };
  }

  return undefined;
}

export function modelRefFor(option: DesktopModelOption, fast: boolean) {
  return {
    provider: option.provider,
    id: fast && option.fastMode.kind === "available" ? option.fastMode.id : option.id,
  };
}

export function modelDisplayName(
  catalog: DesktopCatalog | undefined,
  model: ModelRef | undefined,
): string | undefined {
  if (model === undefined) return undefined;

  const selected = selectedModelOption(catalog?.models ?? [], model);

  if (selected === undefined) return model.id;

  return selected.fast ? `${selected.option.name} Fast` : selected.option.name;
}

const PROVIDER_ICONS = new Map<string, IconName>(
  Object.entries({
    acp: "provider-acp",
    anthropic: "model-anthropic",
    "claude-code": "provider-claude-code",
    "github-copilot": "provider-copilot",
    openai: "model-openai",
    "openai-codex": "provider-openai-codex",
    opencode: "provider-opencode",
    "opencode-go": "provider-opencode",
    openrouter: "provider-openrouter",
    "vercel-ai-gateway": "provider-vercel",
  } satisfies Record<string, IconName>),
);

const ACP_AGENT_ICONS = new Map<string, IconName>(
  Object.entries({
    "amp-acp": "agent-amp",
    "antigravity-acp": "agent-antigravity",
    "claude-acp": "provider-claude-code",
    "codex-acp": "provider-openai-codex",
    cursor: "agent-cursor",
    deepagents: "agent-langchain",
    devin: "agent-devin",
    gemini: "model-gemini",
    "github-copilot-cli": "provider-copilot",
    "glm-acp-agent": "model-zai",
    goose: "agent-goose",
    "grok-build": "grok",
    junie: "agent-junie",
    kilo: "agent-kilo",
    kimi: "model-kimi",
    "minimax-code": "model-minimax",
    "mistral-vibe": "model-mistral",
    opencode: "provider-opencode",
    "qwen-code": "model-qwen",
  } satisfies Record<string, IconName>),
);

export function providerIcon(providerId: string): IconName {
  return PROVIDER_ICONS.get(providerId) ?? "model-generic";
}

export function modelIcon(model: ModelRef): IconName {
  return model.provider === "acp"
    ? (ACP_AGENT_ICONS.get(model.id) ?? "provider-acp")
    : providerIcon(model.provider);
}

export const THINKING_LABELS: Readonly<Record<ModelThinkingLevel, string>> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export function thinkingLevelsFor(
  option: DesktopModelOption | undefined,
): readonly ModelThinkingLevel[] {
  const supported = option?.thinkingLevels ?? (["off"] as const);
  const ordered = MODEL_THINKING_LEVELS.filter((level) => supported.includes(level));

  return ordered.length === 0 ? ["off"] : ordered;
}

export function supportedThinkingLevel(
  option: DesktopModelOption | undefined,
  requested: ModelThinkingLevel | undefined,
): ModelThinkingLevel {
  const levels = thinkingLevelsFor(option);

  if (requested !== undefined && levels.includes(requested)) return requested;

  if (option !== undefined && levels.includes(option.defaultThinking))
    return option.defaultThinking;

  return levels[0] ?? "off";
}

interface TriggerLabel {
  readonly name: string;
  readonly detail: string | undefined;
}

export function modelTriggerLabel(
  option: DesktopModelOption | undefined,
  activeReasoning: ModelThinkingLevel,
  fastOn: boolean,
): TriggerLabel {
  if (option === undefined) return { name: "Choose a model", detail: undefined };
  const parts: string[] = [];

  if (activeReasoning !== "off" && thinkingLevelsFor(option).length > 1) {
    parts.push(THINKING_LABELS[activeReasoning]);
  }

  if (fastOn) parts.push("Fast");

  return { name: option.name, detail: parts.length === 0 ? undefined : parts.join(" · ") };
}

interface PickerGroup {
  readonly id: string;
  readonly label: string;
  readonly disconnected: boolean;
  readonly options: readonly DesktopModelOption[];
}

export function pickerGroups(
  catalog: DesktopCatalog,
  current: DesktopModelOption | undefined,
  search: string,
): PickerGroup[] {
  const needle = search.trim().toLowerCase();
  const providerNames = new Map(catalog.providers.map((provider) => [provider.id, provider.name]));

  const offered = catalog.models.filter(
    (option) =>
      (option.listed || option.key === current?.key) &&
      `${option.name}\n${option.id}\n${providerNames.get(option.provider) ?? ""}`
        .toLowerCase()
        .includes(needle),
  );

  const favorites = offered.filter((option) => option.listed && option.listing === "favorite");

  const providers = catalog.providers.flatMap((provider: ProviderStatus): PickerGroup[] => {
    const options = offered.filter(
      (option) => option.provider === provider.id && !favorites.includes(option),
    );

    return options.length === 0
      ? []
      : [
          {
            id: provider.id,
            label: provider.name,
            disconnected: provider.credential === "missing",
            options,
          },
        ];
  });

  return favorites.length === 0
    ? providers
    : [
        { id: "favorites", label: "Favorites", disconnected: false, options: favorites },
        ...providers,
      ];
}
