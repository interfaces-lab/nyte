/** Thinking-level maps the generator derives for each catalog model from models.dev and known provider quirks. */
import type { Api, Model } from "../../src/types.ts";
import { getEffortThinkingLevelMap } from "../models-dev-reasoning-options.ts";
import {
  detectOpenAICompletionsCompat,
  mergeAnthropicMessagesCompat,
  namesDaybreakBlue,
} from "./compat-metadata.ts";
import type { ModelsDevMetadata } from "./models-dev.ts";

type ThinkingLevelMap = NonNullable<Model<Api>["thinkingLevelMap"]>;

const OPENCODE_GO_GLM52_THINKING_LEVEL_MAP = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  max: "max",
} as const;

const DEEPSEEK_V4_THINKING_LEVEL_MAP = {
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  max: "max",
} as const;

const DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP = {
  ...DEEPSEEK_V4_THINKING_LEVEL_MAP,
  low: "low",
} as const;

const ANT_LING_RING_THINKING_LEVEL_MAP = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: "xhigh",
} as const;

const OPENAI_RESPONSES_NONE_REASONING_MODELS = new Set([
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
]);

/** Model id fragments of the Anthropic models that think adaptively. */
const ANTHROPIC_ADAPTIVE_THINKING_ID_PARTS = [
  "opus-4-6",
  "opus-4.6",
  "opus-4-7",
  "opus-4.7",
  "opus-4-8",
  "opus-4.8",
  "opus-5",
  "opus.5",
  "sonnet-4-6",
  "sonnet-4.6",
  "sonnet-5",
  "sonnet.5",
  "haiku-5",
  "haiku.5",
  "fable-5",
];

/**
 * Claude models that accept `thinking: {type: "disabled"}` although models.dev lists no thinking
 * toggle for them. https://platform.claude.com/docs/en/build-with-claude/thinking#configuring-thinking
 */
const ANTHROPIC_DISABLED_THINKING_MODEL = /(?:^|[./])claude-opus-5(?:-\d{8})?$/;

/** Lowercased model id fragments of the Anthropic models that reject `temperature`. */
const ANTHROPIC_FIXED_TEMPERATURE_ID_PARTS = [
  "opus-4-7",
  "opus-4.7",
  "opus-4-8",
  "opus-4.8",
  "opus-5",
  "opus.5",
];

function mergeThinkingLevelMap(model: Model<Api>, map: ThinkingLevelMap): void {
  model.thinkingLevelMap = { ...model.thinkingLevelMap, ...map };
}

/**
 * Checked manually against the authenticated GitHub Copilot /models endpoint on 2026-06-15.
 * Keep this to narrow corrections over models.dev metadata instead of snapshotting Copilot's catalog.
 */
function getGitHubCopilotThinkingLevelOverride(modelId: string): ThinkingLevelMap | undefined {
  if (
    modelId === "claude-opus-4.7" ||
    modelId === "claude-opus-4.8" ||
    modelId === "claude-opus-5"
  ) {
    return { minimal: "low" };
  }

  if (modelId === "claude-sonnet-4.6") return { minimal: "low", max: "max" };

  return undefined;
}

function supportsDirectReasoningEffort(model: Model<Api>): boolean {
  if (model.api === "anthropic-messages") {
    return (
      model.compat !== undefined &&
      "forceAdaptiveThinking" in model.compat &&
      model.compat.forceAdaptiveThinking === true
    );
  }

  if (
    model.api === "openai-responses" ||
    model.api === "azure-openai-responses" ||
    model.api === "openai-codex-responses"
  ) {
    return true;
  }

  if (model.api !== "openai-completions") return false;

  const compat = {
    ...detectOpenAICompletionsCompat(model),
    ...model.compat,
  };

  return compat.thinkingFormat === "openai" && compat.supportsReasoningEffort;
}

/** Maps models.dev's recorded effort options onto a model, a batch model reading its base model's. */
export function applyModelsDevReasoningOptionMetadata(
  model: Model<Api>,
  metadata: ModelsDevMetadata,
): void {
  const key = `${model.provider}:${model.id}`;
  const reasoningOptions =
    metadata.findReasoningOptions(key) ?? metadata.findReasoningOptions(key.replace(/:batch$/, ""));
  const isModelsDevAnthropicModel =
    /(?:^|[./])claude-/.test(model.id) &&
    (model.api === "anthropic-messages" ||
      model.api === "bedrock-converse-stream" ||
      model.provider === "github-copilot" ||
      model.provider === "openrouter");

  if (
    !reasoningOptions ||
    (!supportsDirectReasoningEffort(model) &&
      !isModelsDevAnthropicModel &&
      model.provider !== "opencode" &&
      model.provider !== "opencode-go")
  )
    return;
  const thinkingLevelMap = getEffortThinkingLevelMap(reasoningOptions);

  if (!thinkingLevelMap) return;

  if (isModelsDevAnthropicModel) {
    if (
      reasoningOptions.some((option) => option.type === "toggle") ||
      ANTHROPIC_DISABLED_THINKING_MODEL.test(model.id)
    ) {
      delete thinkingLevelMap.off;
    } else {
      thinkingLevelMap.off = null;
    }
  }

  mergeThinkingLevelMap(model, thinkingLevelMap);
}

function supportsOpenAiXhigh(modelId: string): boolean {
  return (
    modelId.includes("gpt-5.2") ||
    modelId.includes("gpt-5.3") ||
    modelId.includes("gpt-5.4") ||
    modelId.includes("gpt-5.5") ||
    modelId.includes("gpt-5.6") ||
    modelId.startsWith("gpt-6") ||
    namesDaybreakBlue(modelId)
  );
}

/**
 * Applies the thinking levels each provider's models accept, in order, later maps winning:
 * - xAI models without verified effort options (e.g. grok-build-0.1) must not send the
 *   undocumented "none"/"minimal" efforts.
 * - Kimi K2.7 Code is always-thinking. Official docs say `thinking: { type: "disabled" }`
 *   is rejected, and callers can omit the thinking parameter to use the enabled default.
 * - Mercury 2 in instant mode (reasoning_effort: "none") disables tool calling, so "off" is
 *   unsupported and the openai-completions provider omits the reasoning param instead of
 *   defaulting to {reasoning:{effort:"none"}}. low/medium/high pass through verbatim;
 *   OpenRouter normalizes to Mercury's vocabulary.
 * - OpenCode Go exposes Kimi K2.6 thinking as on/off, not distinct effort tiers.
 * - OpenCode Zen Grok Build reasons by default but rejects explicit reasoningEffort.
 * - Ant Ling Ring reasons by default. Only high/xhigh have documented explicit effort controls.
 */
export function applyThinkingLevelMetadata(model: Model<Api>): void {
  if (
    (model.api === "openai-responses" || model.api === "azure-openai-responses") &&
    model.id.startsWith("gpt-5")
  ) {
    mergeThinkingLevelMap(model, { off: null });
  }

  if (model.provider === "github-copilot" && model.id.startsWith("gpt-5")) {
    mergeThinkingLevelMap(model, { minimal: "low" });
  }

  if (
    model.api === "openai-responses" &&
    model.provider === "openai" &&
    OPENAI_RESPONSES_NONE_REASONING_MODELS.has(model.id)
  ) {
    mergeThinkingLevelMap(model, { off: "none" });
  }

  if (
    model.provider === "xai" &&
    model.api === "openai-responses" &&
    model.thinkingLevelMap === undefined
  ) {
    mergeThinkingLevelMap(model, { off: null, minimal: null });
  }

  if (supportsOpenAiXhigh(model.id)) {
    mergeThinkingLevelMap(model, { xhigh: "xhigh" });
  }

  if (
    (model.id.includes("gpt-5.6") || model.id.startsWith("gpt-6") || namesDaybreakBlue(model.id)) &&
    (model.api === "openai-responses" ||
      model.api === "azure-openai-responses" ||
      model.api === "openai-codex-responses" ||
      model.api === "openai-completions")
  ) {
    mergeThinkingLevelMap(model, { max: "max" });
  }

  if (model.provider === "openai" && model.id === "gpt-5.5") {
    mergeThinkingLevelMap(model, { minimal: null });
  }

  if (model.id === "gpt-6-astra") {
    mergeThinkingLevelMap(model, { off: null, minimal: null });
  }

  if (model.provider === "openai-codex" && model.id.startsWith("gpt-6")) {
    mergeThinkingLevelMap(model, { off: null });
  }

  if (namesDaybreakBlue(model.id)) {
    mergeThinkingLevelMap(model, { off: null });
  }

  if (model.id.endsWith("gpt-5.5-pro")) {
    mergeThinkingLevelMap(model, { off: null, minimal: null, low: null });
  }

  if (
    model.api === "anthropic-messages" &&
    ANTHROPIC_ADAPTIVE_THINKING_ID_PARTS.some((part) => model.id.includes(part))
  ) {
    mergeAnthropicMessagesCompat(model, { forceAdaptiveThinking: true });
  }

  if (
    model.api === "anthropic-messages" &&
    ANTHROPIC_FIXED_TEMPERATURE_ID_PARTS.some((part) => model.id.toLowerCase().includes(part))
  ) {
    mergeAnthropicMessagesCompat(model, { supportsTemperature: false });
  }

  if (model.api === "openai-completions" && model.id.includes("deepseek-v4")) {
    mergeThinkingLevelMap(
      model,
      model.provider === "openrouter"
        ? { ...DEEPSEEK_V4_THINKING_LEVEL_MAP, xhigh: "xhigh", max: null }
        : (model.provider === "deepseek" ||
              model.provider === "opencode" ||
              model.provider === "opencode-go") &&
            model.id.includes("deepseek-v4") &&
            model.id.includes("flash")
          ? DEEPSEEK_V4_FLASH_THINKING_LEVEL_MAP
          : DEEPSEEK_V4_THINKING_LEVEL_MAP,
    );
  }

  if (model.api === "google-generative-ai" || model.api === "google-vertex") {
    const id = model.id.toLowerCase();

    if (/gemini-3(?:\.\d+)?-pro/.test(id)) {
      mergeThinkingLevelMap(model, {
        off: null,
        minimal: null,
        low: "LOW",
        medium: null,
        high: "HIGH",
      });
    }

    if (
      /gemini-3(?:\.\d+)?-flash/.test(id) ||
      id === "gemini-flash-latest" ||
      id === "gemini-flash-lite-latest"
    ) {
      mergeThinkingLevelMap(model, { off: null });
    }

    if (/gemma-?4/.test(id)) {
      mergeThinkingLevelMap(model, {
        off: null,
        minimal: "MINIMAL",
        low: null,
        medium: null,
        high: "HIGH",
      });
    }
  }

  if (model.provider === "groq" && model.id === "qwen/qwen3.6-27b") {
    mergeThinkingLevelMap(model, { minimal: null, low: null, medium: null, high: "default" });
  }

  if (model.provider === "openai-codex" && supportsOpenAiXhigh(model.id)) {
    mergeThinkingLevelMap(model, { minimal: "low" });
  }

  if (
    (model.provider === "moonshotai" || model.provider === "moonshotai-cn") &&
    (model.id === "kimi-k2.7-code" || model.id === "kimi-k2.7-code-highspeed")
  ) {
    mergeThinkingLevelMap(model, { off: null });
  }

  if (model.provider === "openrouter" && model.id.startsWith("inception/mercury-2")) {
    mergeThinkingLevelMap(model, { off: null });
  }

  if (model.provider === "openrouter" && model.id === "z-ai/glm-5.2") {
    mergeThinkingLevelMap(model, { xhigh: "xhigh" });
  }

  if (model.provider === "fireworks" && model.id.includes("glm-5p2")) {
    mergeThinkingLevelMap(model, {
      off: "none",
      minimal: null,
      low: "high",
      medium: "high",
      max: "max",
    });
  }

  if (model.provider === "opencode-go" && model.id === "glm-5.2") {
    mergeThinkingLevelMap(model, OPENCODE_GO_GLM52_THINKING_LEVEL_MAP);
  }

  if (model.provider === "opencode-go" && model.id === "kimi-k2.6") {
    mergeThinkingLevelMap(model, { minimal: null, low: null, medium: null });
  }

  if (model.provider === "opencode" && model.id === "grok-build-0.1") {
    mergeThinkingLevelMap(model, { off: null, minimal: null, low: null, medium: null });
  }

  if (model.provider === "ant-ling" && model.reasoning) {
    mergeThinkingLevelMap(model, ANT_LING_RING_THINKING_LEVEL_MAP);
  }

  if (model.provider === "github-copilot") {
    const override = getGitHubCopilotThinkingLevelOverride(model.id);

    if (override) {
      mergeThinkingLevelMap(model, override);
    }
  }
}
