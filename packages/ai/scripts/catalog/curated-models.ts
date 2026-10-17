/** Models and corrections the generator keeps by hand: entries no upstream catalog lists, and fixes for metadata it gets wrong. */
import type { Api, Model, OpenAICompletionsCompat } from "../../src/types.ts";
import { OPENAI_DAYBREAK_BLUE_MODEL_ID } from "./compat-metadata.ts";
import {
  KIMI_K3_MAX_TOKENS,
  OPENAI_GPT_56_LUNA_STANDARD_COST,
  OPENAI_GPT_56_STANDARD_COSTS,
  OPENAI_GPT_56_TERRA_STANDARD_COST,
  OPENAI_GPT_6_ASTRA_STANDARD_COST,
  OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
  withOpenAiLongContextPricing,
} from "./costs.ts";

const XAI_BUILTIN_EXCLUDED_MODEL_IDS = new Set([
  "grok-3",
  "grok-3-fast",
  "grok-4.20-0309-non-reasoning",
  "grok-4.20-0309-reasoning",
  "grok-code-fast-1",
]);

/**
 * GitHub's "Models with extended capabilities" table lists these Copilot models as supporting
 * the extended 1 million token context window.
 */
const GITHUB_COPILOT_EXTENDED_CONTEXT_MODELS = new Set([
  "claude-fable-5",
  "claude-opus-4.6",
  "claude-opus-4.7",
  "claude-opus-4.8",
  "claude-opus-5",
  "claude-sonnet-4.6",
  "claude-sonnet-5",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.5",
]);

const OPENAI_SHORT_CONTEXT_CAPPED_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
]);

const OPENAI_LONG_CONTEXT_PRICING_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
]);

const OPENROUTER_KIMI_K3_MODEL_IDS = new Set(["moonshotai/kimi-k3", "~moonshotai/kimi-latest"]);

const QWEN_TOKEN_PLAN_PROVIDER_IDS = new Set<string>([
  "qwen-token-plan",
  "qwen-token-plan-cn",
  "qwen-token-plan-individual",
]);

const MINIMAX_DIRECT_SUPPORTED_IDS = new Set([
  "MiniMax-M2.7",
  "MiniMax-M2.7-highspeed",
  "MiniMax-M3",
]);

/** Azure Foundry deploys these with larger context windows than OpenAI's own short-tier defaults; see models-sold-directly-by-azure docs. */
const AZURE_LARGE_CONTEXT_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-6-astra",
]);

/** Direct OpenAI models added when models.dev does not list them. */
const MISSING_OPENAI_MODELS: Model<"openai-responses">[] = [
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    provider: "openai",
    reasoning: true,
    input: ["text", "image"],
    cost: withOpenAiLongContextPricing(OPENAI_GPT_6_ASTRA_STANDARD_COST),
    contextWindow: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
    maxTokens: 128000,
    modes: ["fast"],
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    provider: "openai",
    reasoning: true,
    input: ["text", "image"],
    cost: withOpenAiLongContextPricing({
      input: 5,
      output: 30,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    }),
    contextWindow: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
    maxTokens: 128000,
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    provider: "openai",
    reasoning: true,
    input: ["text", "image"],
    cost: withOpenAiLongContextPricing(OPENAI_GPT_56_TERRA_STANDARD_COST),
    contextWindow: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
    maxTokens: 128000,
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    provider: "openai",
    reasoning: true,
    input: ["text", "image"],
    cost: withOpenAiLongContextPricing(OPENAI_GPT_56_LUNA_STANDARD_COST),
    contextWindow: OPENAI_LONG_CONTEXT_INPUT_THRESHOLD,
    maxTokens: 128000,
  },
  {
    id: "gpt-5-chat-latest",
    name: "GPT-5 Chat Latest",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    provider: "openai",
    reasoning: false,
    input: ["text", "image"],
    cost: {
      input: 1.25,
      output: 10,
      cacheRead: 0.125,
      cacheWrite: 0,
    },
    contextWindow: 128000,
    maxTokens: 16384,
  },
];

const DEEPSEEK_COMPAT: OpenAICompletionsCompat = {
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: "deepseek",
};

const DEEPSEEK_V4_MODELS: Model<"openai-completions">[] = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com",
    provider: "deepseek",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0.14,
      output: 0.28,
      cacheRead: 0.0028,
      cacheWrite: 0,
    },
    contextWindow: 1000000,
    maxTokens: 384000,
    compat: DEEPSEEK_COMPAT,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com",
    provider: "deepseek",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0.435,
      output: 0.87,
      cacheRead: 0.003625,
      cacheWrite: 0,
    },
    contextWindow: 1000000,
    maxTokens: 384000,
    compat: DEEPSEEK_COMPAT,
  },
];

const ANT_LING_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
  supportsLongCacheRetention: false,
};

const ANT_LING_MODELS: Model<"openai-completions">[] = [
  {
    id: "Ling-2.6-flash",
    name: "Ling 2.6 Flash",
    api: "openai-completions",
    baseUrl: "https://api.ant-ling.com/v1",
    provider: "ant-ling",
    reasoning: false,
    input: ["text"],
    cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 65536,
    compat: ANT_LING_COMPAT,
  },
  {
    id: "Ling-2.6-1T",
    name: "Ling 2.6 1T",
    api: "openai-completions",
    baseUrl: "https://api.ant-ling.com/v1",
    provider: "ant-ling",
    reasoning: false,
    input: ["text"],
    cost: { input: 0.06, output: 0.25, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 65536,
    compat: ANT_LING_COMPAT,
  },
  {
    id: "Ring-2.6-1T",
    name: "Ring 2.6 1T",
    api: "openai-completions",
    baseUrl: "https://api.ant-ling.com/v1",
    provider: "ant-ling",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.06, output: 0.25, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 65536,
    compat: { ...ANT_LING_COMPAT, thinkingFormat: "ant-ling" },
  },
];

const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

const CODEX_CONTEXT = 272000;

const CODEX_GPT_56_CONTEXT = 272000;

const CODEX_SPARK_CONTEXT = 128000;

const CODEX_MAX_TOKENS = 128000;

/**
 * OpenAI Codex (ChatGPT OAuth) models. models.dev does not list them; this small, explicit
 * list avoids aliases. Older model limits are based on observed server behavior; GPT-5.6
 * follows Codex's 272k catalog limit (formerly 372k).
 */
const CODEX_MODELS: Model<"openai-codex-responses">[] = [
  {
    id: "gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    input: ["text"],
    cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
    contextWindow: CODEX_SPARK_CONTEXT,
    maxTokens: CODEX_MAX_TOKENS,
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: withOpenAiLongContextPricing({ input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 }),
    contextWindow: CODEX_CONTEXT,
    maxTokens: CODEX_MAX_TOKENS,
  },
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: withOpenAiLongContextPricing(OPENAI_GPT_6_ASTRA_STANDARD_COST),
    contextWindow: CODEX_CONTEXT,
    maxTokens: CODEX_MAX_TOKENS,
    modes: ["fast"],
  },
  {
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    contextWindow: 500000,
    maxTokens: CODEX_MAX_TOKENS,
  },
  {
    id: "gpt-6-sol",
    name: "GPT-6 Sol",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    contextWindow: CODEX_CONTEXT,
    maxTokens: CODEX_MAX_TOKENS,
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    contextWindow: CODEX_CONTEXT,
    maxTokens: CODEX_MAX_TOKENS,
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: withOpenAiLongContextPricing(OPENAI_GPT_56_LUNA_STANDARD_COST),
    contextWindow: CODEX_GPT_56_CONTEXT,
    maxTokens: CODEX_MAX_TOKENS,
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: withOpenAiLongContextPricing({
      input: 5,
      output: 30,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    }),
    contextWindow: CODEX_GPT_56_CONTEXT,
    maxTokens: CODEX_MAX_TOKENS,
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: withOpenAiLongContextPricing(OPENAI_GPT_56_TERRA_STANDARD_COST),
    contextWindow: CODEX_GPT_56_CONTEXT,
    maxTokens: CODEX_MAX_TOKENS,
  },
  /**
   * Codex ships this as a hidden cyber-specialty alias of GPT-5.6 Sol. Nyte lists it so
   * ChatGPT-authenticated TUI and desktop sessions can select it.
   * https://github.com/openai/codex/blob/main/codex-rs/models-manager/models.json
   */
  {
    id: OPENAI_DAYBREAK_BLUE_MODEL_ID,
    name: "Daybreak Blue",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: withOpenAiLongContextPricing({
      input: 5,
      output: 30,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    }),
    contextWindow: CODEX_GPT_56_CONTEXT,
    maxTokens: CODEX_MAX_TOKENS,
  },
];

/** Mistral Medium 3.5, added until models.dev includes it; its 256k-token window is also its output cap. */
const MISTRAL_MEDIUM_35: Model<"mistral-conversations"> = {
  id: "mistral-medium-3.5",
  name: "Mistral Medium 3.5",
  api: "mistral-conversations",
  provider: "mistral",
  baseUrl: "https://api.mistral.ai",
  reasoning: true,
  input: ["text", "image"],
  cost: {
    input: 1.5,
    output: 7.5,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 262144,
  maxTokens: 262144,
};

/** The openrouter/auto alias. Its cost is unknown: OpenRouter routes to different models and charges for the one used. */
const OPENROUTER_AUTO: Model<"openai-completions"> = {
  id: "auto",
  name: "Auto",
  api: "openai-completions",
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  reasoning: true,
  input: ["text", "image"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 2000000,
  maxTokens: 30000,
};

/**
 * The openrouter/fusion alias. OpenRouter exposes Fusion as a router alias/plugin entry
 * point; its model metadata does not advertise tools, but the alias resolves to a concrete
 * model that can invoke caller tools and has the openrouter:fusion server tool auto-injected.
 * Its cost is unknown: Fusion routes to multiple models and charges for the ones used.
 */
const OPENROUTER_FUSION: Model<"openai-completions"> = {
  id: "openrouter/fusion",
  name: "OpenRouter: Fusion",
  api: "openai-completions",
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  reasoning: true,
  input: ["text"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 1000000,
  maxTokens: 30000,
};

/** Drops the xAI models Nyte does not ship and OpenCode's Codex Spark, which only Codex serves. */
export function withoutUnservedModels(models: readonly Model<Api>[]): Model<Api>[] {
  return models.filter(
    (model) =>
      !(model.provider === "xai" && XAI_BUILTIN_EXCLUDED_MODEL_IDS.has(model.id)) &&
      !(
        (model.provider === "opencode" || model.provider === "opencode-go") &&
        model.id === "gpt-5.3-codex-spark"
      ),
  );
}

/**
 * Corrects upstream metadata until it is fixed at the source:
 * - OpenCode variants list Claude Sonnet 4/4.5 with 1M context; the actual limit is 200K.
 * - Direct OpenAI requests stay in the short-context pricing tier by default. Users can opt
 *   into the larger context through model overrides, so the capped models keep long-context
 *   cost metadata.
 * - Cloudflare AI Gateway passes OpenAI usage through at OpenAI list prices.
 * - models.dev reports gpt-5-pro output as 272000 (a duplicate of the input sub-limit); the
 *   actual max output is 128000. This also reaches the derived Azure clone.
 * - Kimi K3 keeps its output limit when gateway metadata is missing or incorrect.
 * - Selected OpenRouter model metadata stays stable until upstream settles.
 */
export function applyUpstreamCorrections(models: readonly Model<Api>[]): void {
  for (const candidate of models) {
    if (
      candidate.provider === "github-copilot" &&
      GITHUB_COPILOT_EXTENDED_CONTEXT_MODELS.has(candidate.id)
    ) {
      candidate.contextWindow = 1000000;
    }

    if (
      (candidate.provider === "anthropic" ||
        candidate.provider === "opencode" ||
        candidate.provider === "opencode-go") &&
      (candidate.id === "claude-opus-4-6" ||
        candidate.id === "claude-sonnet-4-6" ||
        candidate.id === "claude-opus-4.6" ||
        candidate.id === "claude-sonnet-4.6")
    ) {
      candidate.contextWindow = 1000000;
    }

    if (
      (candidate.provider === "opencode" || candidate.provider === "opencode-go") &&
      (candidate.id === "claude-sonnet-4-5" || candidate.id === "claude-sonnet-4")
    ) {
      candidate.contextWindow = 200000;
    }

    if (
      (candidate.provider === "opencode" || candidate.provider === "opencode-go") &&
      candidate.id === "gpt-5.4"
    ) {
      candidate.contextWindow = 272000;
      candidate.maxTokens = 128000;
    }

    if (
      candidate.provider === "openai" &&
      OPENAI_SHORT_CONTEXT_CAPPED_MODEL_IDS.has(candidate.id)
    ) {
      candidate.contextWindow = OPENAI_LONG_CONTEXT_INPUT_THRESHOLD;
      candidate.maxTokens = 128000;
    }

    if (
      candidate.provider === "openai" &&
      OPENAI_LONG_CONTEXT_PRICING_MODEL_IDS.has(candidate.id)
    ) {
      const standardCost = OPENAI_GPT_56_STANDARD_COSTS.get(candidate.id);
      candidate.cost = withOpenAiLongContextPricing(standardCost ?? candidate.cost);
    }

    if (candidate.provider === "cloudflare-ai-gateway") {
      const standardCost = OPENAI_GPT_56_STANDARD_COSTS.get(candidate.id);

      if (standardCost) candidate.cost = withOpenAiLongContextPricing(standardCost);
    }

    if (candidate.provider === "openai" && candidate.id === "gpt-5-pro") {
      candidate.maxTokens = 128000;
    }

    if (
      (candidate.provider === "openrouter" && OPENROUTER_KIMI_K3_MODEL_IDS.has(candidate.id)) ||
      (candidate.provider === "vercel-ai-gateway" && candidate.id === "moonshotai/kimi-k3")
    ) {
      candidate.maxTokens = KIMI_K3_MAX_TOKENS;
    }

    if (candidate.provider === "openrouter" && candidate.id === "moonshotai/kimi-k2.5") {
      candidate.cost.input = 0.41;
      candidate.cost.output = 2.06;
      candidate.cost.cacheRead = 0.07;
      candidate.maxTokens = 4096;
    }

    if (candidate.provider === "openrouter" && candidate.id.startsWith("moonshotai/kimi-k2.6")) {
      candidate.compat = {
        ...candidate.compat,
        supportsDeveloperRole: false,
        requiresReasoningContentOnAssistantMessages: true,
      };
    }

    if (candidate.provider === "openrouter" && candidate.id === "z-ai/glm-5") {
      candidate.cost.input = 0.6;
      candidate.cost.output = 1.9;
      candidate.cost.cacheRead = 0.119;
    }
  }
}

function addUnlisted(models: Model<Api>[], model: Model<Api>): void {
  if (!models.some((m) => m.provider === model.provider && m.id === model.id)) {
    models.push(model);
  }
}

/**
 * Adds the hand-kept models in catalog order, gives every DeepSeek V4 Chat Completions model
 * outside the Qwen token plans DeepSeek's reasoning replay (OpenRouter and OpenCode keep their
 * native reasoning effort), drops the MiniMax models the direct API does not serve, and clones
 * each direct OpenAI Responses model for Azure.
 */
export function addCuratedModels(models: Model<Api>[]): void {
  for (const model of MISSING_OPENAI_MODELS) addUnlisted(models, model);

  models.push(...DEEPSEEK_V4_MODELS);
  models.push(...ANT_LING_MODELS);

  for (const candidate of models) {
    if (
      candidate.api === "openai-completions" &&
      candidate.id.includes("deepseek-v4") &&
      !QWEN_TOKEN_PLAN_PROVIDER_IDS.has(candidate.provider)
    ) {
      const preservesNativeReasoningEffort =
        candidate.provider === "openrouter" || candidate.provider === "opencode";

      candidate.compat = {
        ...candidate.compat,
        ...(preservesNativeReasoningEffort
          ? {
              requiresReasoningContentOnAssistantMessages:
                DEEPSEEK_COMPAT.requiresReasoningContentOnAssistantMessages,
            }
          : DEEPSEEK_COMPAT),
      };
    }
  }

  for (let i = models.length - 1; i >= 0; i--) {
    const candidate = models[i];

    if (
      (candidate.provider === "minimax" || candidate.provider === "minimax-cn") &&
      !MINIMAX_DIRECT_SUPPORTED_IDS.has(candidate.id)
    ) {
      models.splice(i, 1);
    }
  }

  models.push(...CODEX_MODELS);
  addUnlisted(models, MISTRAL_MEDIUM_35);
  addUnlisted(models, OPENROUTER_AUTO);
  addUnlisted(models, OPENROUTER_FUSION);

  const azureOpenAiModels: Model<Api>[] = models.flatMap((model) =>
    model.provider === "openai" && model.api === "openai-responses"
      ? [
          {
            ...model,
            api: "azure-openai-responses",
            provider: "azure-openai-responses",
            baseUrl: "",
            cost: {
              input: model.cost.input,
              output: model.cost.output,
              cacheRead: model.cost.cacheRead,
              cacheWrite: model.cost.cacheWrite,
            },
            contextWindow: AZURE_LARGE_CONTEXT_MODEL_IDS.has(model.id)
              ? 1050000
              : model.contextWindow,
          },
        ]
      : [],
  );

  models.push(...azureOpenAiModels);
}
