/** Catalog models for providers that serve their own models.dev listings: model labs and their coding plans. */
import type {
  AnthropicMessagesCompat,
  Api,
  Model,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
} from "../../src/types.ts";
import { getEffortThinkingLevelMap } from "../models-dev-reasoning-options.ts";
import { KIMI_CODING_IMPLIED_COSTS, KIMI_K3_COST, roundCost } from "./costs.ts";
import {
  flatCost,
  modelInput,
  modelsDevCost,
  modelsDevModel,
  recordModelsDevMetadata,
  type ModelsDevCatalog,
  type ModelsDevModel,
} from "./models-dev.ts";

const VERTEX_BASE_URL = "https://{location}-aiplatform.googleapis.com";

const BEDROCK_INFERENCE_PROFILE_ONLY_MODEL_IDS = new Set(["anthropic.claude-opus-5"]);

/** models.dev lists these aliases, but OpenAI APIs do not accept them. */
const MODELS_DEV_OPENAI_UNSUPPORTED_MODEL_IDS = new Set(["gpt-5.6"]);

const XAI_RESPONSES_COMPAT: OpenAIResponsesCompat = {
  supportsLongCacheRetention: false,
};

const ZAI_TOOL_STREAM_UNSUPPORTED_MODELS = new Set([
  "glm-4.5",
  "glm-4.5-air",
  "glm-4.5-flash",
  "glm-4.5v",
]);

const QWEN_TOKEN_PLAN_HIGH_MAX_THINKING_LEVEL_MAP = {
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: null,
  max: "max",
} as const;

const QWEN_TOKEN_PLAN_QWEN38_THINKING_LEVEL_MAP = {
  minimal: null,
  low: "low",
  medium: "medium",
  high: null,
  xhigh: "xhigh",
  max: null,
} as const;

const QWEN_TOKEN_PLAN_REASONING_EFFORT_UNSUPPORTED_MODEL_IDS = new Set([
  "MiniMax-M2.5",
  "deepseek-v3.2",
  "kimi-k2.5",
  "kimi-k2.6",
  "kimi-k2.7-code",
  "qwen3.6-flash",
  "qwen3.6-plus",
  "qwen3.7-max",
  "qwen3.7-plus",
]);

// Retired preview id — models.dev may still list it after GA ships.
const QWEN_TOKEN_PLAN_EXCLUDED_MODEL_IDS = new Set(["qwen3.8-max-preview"]);

/**
 * QwenCloud Token Plan Individual text-model allowlist, verified 2026-08-05.
 * Retired models remain excluded above even if the public catalog lags.
 * https://docs.qwencloud.com/token-plan/personal/token-plan-personal-overview
 */
const QWEN_TOKEN_PLAN_INDIVIDUAL_MODEL_IDS = new Set<string>([
  "deepseek-v4-flash-0731",
  "deepseek-v4-pro",
  "deepseek-v4-pro-0813",
  "glm-5.2",
  "qwen3.6-flash",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.8-max",
]);

function bedrockBaseUrl(modelId: string): string {
  return modelId.startsWith("eu.")
    ? "https://bedrock-runtime.eu-central-1.amazonaws.com"
    : "https://bedrock-runtime.us-east-1.amazonaws.com";
}

/** Amazon Bedrock models, without AI21 Jamba (no tool use in streaming mode) and Mistral 7B Instruct v0 (no system messages). */
export function bedrockModels(data: ModelsDevCatalog): Model<Api>[] {
  const models: Model<Api>[] = [];

  for (const [id, m] of Object.entries(data["amazon-bedrock"]?.models ?? {})) {
    if (m.tool_call !== true) continue;

    if (BEDROCK_INFERENCE_PROFILE_ONLY_MODEL_IDS.has(id)) continue;

    if (id.startsWith("ai21.jamba")) continue;

    if (id.startsWith("mistral.mistral-7b-instruct-v0")) continue;

    models.push({
      ...modelsDevModel(id, m, "bedrock-converse-stream", "amazon-bedrock", bedrockBaseUrl(id)),
      ...(m.structured_output === true && { compat: { supportsStrictMode: true } }),
    });
    recordModelsDevMetadata("amazon-bedrock", id, m);
  }

  return models;
}

/** Anthropic models, adding Claude Haiku 5.5 until models.dev lists it and correcting Sonnet 5.5's cache-read price. */
export function anthropicModels(data: ModelsDevCatalog): Model<Api>[] {
  const anthropic = data.anthropic?.models;

  if (!anthropic) return [];

  anthropic["claude-haiku-5-5"] ??= {
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    tool_call: true,
    structured_output: true,
    reasoning: true,
    reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
    modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    limit: { context: 1000000, output: 128000 },
    cost: {
      input: 0.1,
      output: 0.5,
      cache_read: 0.01,
      cache_write: 0.125,
      tiers: [
        {
          input: 0.5,
          output: 2.5,
          cache_read: 0.05,
          cache_write: 0.625,
          tier: { type: "context", size: 100000 },
        },
      ],
    },
  };

  const sonnet55 = anthropic["claude-sonnet-5-5"];

  if (sonnet55?.cost && sonnet55.cost.cache_read === 0.2) sonnet55.cost.cache_read = 0.1;

  const models: Model<Api>[] = [];

  for (const [modelId, m] of Object.entries(anthropic)) {
    if (m.tool_call !== true) continue;

    models.push({
      id: modelId,
      name: m.name || modelId,
      api: "anthropic-messages",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      reasoning: m.reasoning === true,
      input: modelInput(m),
      cost: modelsDevCost(m.cost),
      contextWindow: m.limit?.context || 4096,
      maxTokens: m.limit?.output || 4096,
    });
    recordModelsDevMetadata("anthropic", modelId, m);
  }

  return models;
}

/** The model a `-latest` Gemini alias currently points at in a provider's listing. */
function geminiAliasSource(
  models: Record<string, ModelsDevModel>,
  modelId: string,
  model: ModelsDevModel,
): ModelsDevModel {
  if (modelId === "gemini-flash-latest") return models["gemini-3.5-flash"] ?? model;

  if (modelId === "gemini-flash-lite-latest") return models["gemini-3.1-flash-lite"] ?? model;

  return model;
}

/** Gemini API models; the `-latest` aliases take their target's capabilities and prices. */
export function googleModels(data: ModelsDevCatalog): Model<Api>[] {
  const google = data.google?.models;
  const models: Model<Api>[] = [];

  for (const [modelId, m] of Object.entries(google ?? {})) {
    if (m.tool_call !== true) continue;
    const source = geminiAliasSource(google ?? {}, modelId, m);

    models.push({
      id: modelId,
      name: m.name || modelId,
      api: "google-generative-ai",
      provider: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      reasoning: source.reasoning === true,
      input: modelInput(source),
      cost: flatCost(source.cost),
      contextWindow: source.limit?.context || 4096,
      maxTokens: source.limit?.output || 4096,
    });
    recordModelsDevMetadata("google", modelId, source);
  }

  return models;
}

/**
 * Google Vertex Gemini models. The google-vertex models.dev catalog also includes Claude,
 * OpenAI, and other MaaS models that do not use the @google/genai Gemini streaming path the
 * google-vertex provider implements. models.dev reports Vertex cache prices for Gemini 2.5
 * Flash that do not match the official Gemini API standard pricing table; only
 * cachedContentTokenCount counts as cacheRead.
 */
export function vertexModels(data: ModelsDevCatalog): Model<Api>[] {
  const vertex = data["google-vertex"]?.models;
  const models: Model<Api>[] = [];

  for (const [modelId, m] of Object.entries(vertex ?? {})) {
    if (m.tool_call !== true) continue;

    if (!modelId.startsWith("gemini-")) continue;

    if (modelId === "gemini-3.1-flash-lite-preview") continue;
    const source = geminiAliasSource(vertex ?? {}, modelId, m);
    const cacheRead = modelId === "gemini-2.5-flash" ? 0.03 : source.cost?.cache_read || 0;

    models.push({
      id: modelId,
      name: m.name || modelId,
      api: "google-vertex",
      provider: "google-vertex",
      baseUrl: VERTEX_BASE_URL,
      reasoning: source.reasoning === true,
      input: modelInput(source),
      cost: {
        input: source.cost?.input || 0,
        output: source.cost?.output || 0,
        cacheRead,
        cacheWrite: 0,
      },
      contextWindow: source.limit?.context || 4096,
      maxTokens: source.limit?.output || 4096,
    });
    recordModelsDevMetadata("google-vertex", modelId, source);
  }

  return models;
}

/** The tool-capable models of a models.dev provider that need nothing beyond the common fields. */
export function plainModels(
  data: ModelsDevCatalog,
  source: string,
  api: Api,
  baseUrl: string,
  excluded: ReadonlySet<string> = new Set(),
): Model<Api>[] {
  const models: Model<Api>[] = [];

  for (const [modelId, m] of Object.entries(data[source]?.models ?? {})) {
    if (m.tool_call !== true) continue;

    if (excluded.has(modelId)) continue;

    models.push(modelsDevModel(modelId, m, api, source, baseUrl));
    recordModelsDevMetadata(source, modelId, m);
  }

  return models;
}

/** OpenAI models over the Responses API. */
export function openAiModels(data: ModelsDevCatalog): Model<Api>[] {
  return plainModels(
    data,
    "openai",
    "openai-responses",
    "https://api.openai.com/v1",
    MODELS_DEV_OPENAI_UNSUPPORTED_MODEL_IDS,
  );
}

export function xaiModels(data: ModelsDevCatalog): Model<Api>[] {
  const models: Model<Api>[] = [];

  for (const [modelId, m] of Object.entries(data.xai?.models ?? {})) {
    if (m.tool_call !== true) continue;

    models.push({
      id: modelId,
      name: m.name || modelId,
      api: "openai-responses",
      provider: "xai",
      baseUrl: "https://api.x.ai/v1",
      compat: { ...XAI_RESPONSES_COMPAT },
      reasoning: m.reasoning === true,
      input: modelInput(m),
      cost: flatCost(m.cost),
      contextWindow: m.limit?.context || 4096,
      maxTokens: m.limit?.output || 4096,
    });
    recordModelsDevMetadata("xai", modelId, m);
  }

  return models;
}

/** Z.ai's international and China coding plans, priced at Z.ai's API rates when models.dev lists them. */
export function zaiModels(data: ModelsDevCatalog): Model<Api>[] {
  const variants = [
    {
      source: "zai-coding-plan",
      provider: "zai",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
    },
    {
      source: "zhipuai-coding-plan",
      provider: "zai-coding-cn",
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    },
  ] as const;

  const models: Model<Api>[] = [];

  for (const { source, provider, baseUrl } of variants) {
    for (const [modelId, m] of Object.entries(data[source]?.models ?? {})) {
      if (m.tool_call !== true) continue;
      const supportsImage = m.modalities?.input?.includes("image");

      const thinkingLevelMap = getEffortThinkingLevelMap(m.reasoning_options ?? []);
      const isGlm52 = modelId === "glm-5.2" || modelId === "glm-5.2-highspeed";

      if (thinkingLevelMap && isGlm52) {
        thinkingLevelMap.off = "none";
      }

      const supportsReasoningEffort = thinkingLevelMap !== undefined;
      const referenceCost = data.zai?.models?.[modelId]?.cost ?? m.cost;

      const compat: OpenAICompletionsCompat = {
        supportsDeveloperRole: false,
        thinkingFormat: "zai",
      };

      if (supportsReasoningEffort) compat.supportsReasoningEffort = true;

      if (!ZAI_TOOL_STREAM_UNSUPPORTED_MODELS.has(modelId)) compat.zaiToolStream = true;

      const zaiModel: Model<Api> = {
        id: modelId,
        name: m.name || modelId,
        api: "openai-completions",
        provider,
        baseUrl,
        reasoning: m.reasoning === true,
        input: supportsImage ? ["text", "image"] : ["text"],
        cost: flatCost(referenceCost),
        compat,
        contextWindow: m.limit?.context || 4096,
        maxTokens: m.limit?.output || 4096,
      };

      if (thinkingLevelMap) zaiModel.thinkingLevelMap = thinkingLevelMap;
      models.push(zaiModel);
      recordModelsDevMetadata(provider, modelId, m);
    }
  }

  return models;
}

/** Mistral models; a missing cache-read price defaults to a tenth of the input price. */
export function mistralModels(data: ModelsDevCatalog): Model<Api>[] {
  const models: Model<Api>[] = [];

  for (const [modelId, m] of Object.entries(data.mistral?.models ?? {})) {
    if (m.tool_call !== true) continue;

    models.push({
      id: modelId,
      name: m.name || modelId,
      api: "mistral-conversations",
      provider: "mistral",
      baseUrl: "https://api.mistral.ai",
      reasoning: m.reasoning === true,
      input: modelInput(m),
      cost: {
        input: m.cost?.input || 0,
        output: m.cost?.output || 0,
        cacheRead: m.cost?.cache_read ?? (m.cost?.input ? roundCost(m.cost.input * 0.1) : 0),
        cacheWrite: m.cost?.cache_write || 0,
      },
      contextWindow: m.limit?.context || 4096,
      maxTokens: m.limit?.output || 4096,
    });
    recordModelsDevMetadata("mistral", modelId, m);
  }

  return models;
}

/** MiniMax's international and China Anthropic-compatible APIs; the SDK appends /v1/messages. */
export function minimaxModels(data: ModelsDevCatalog): Model<Api>[] {
  const variants = [
    { key: "minimax", provider: "minimax", baseUrl: "https://api.minimax.io/anthropic" },
    { key: "minimax-cn", provider: "minimax-cn", baseUrl: "https://api.minimaxi.com/anthropic" },
  ] as const;

  const models: Model<Api>[] = [];

  for (const { key, provider, baseUrl } of variants) {
    for (const [modelId, m] of Object.entries(data[key]?.models ?? {})) {
      if (m.tool_call !== true) continue;

      models.push(modelsDevModel(modelId, m, "anthropic-messages", provider, baseUrl));
      recordModelsDevMetadata(provider, modelId, m);
    }
  }

  return models;
}

/**
 * Kimi For Coding over its Anthropic-compatible API; the SDK appends /v1/messages. models.dev
 * may expose versioned aliases (k2p5, k2p6, k2p7): they become kimi-for-coding, and are dropped
 * when that id is listed itself. Zero prices fall back to the implied Moonshot API rates.
 */
export function kimiCodingModels(data: ModelsDevCatalog): Model<Api>[] {
  const kimiModels = data["kimi-for-coding"]?.models;

  if (!kimiModels) return [];
  const hasKimiForCoding = Object.hasOwn(kimiModels, "kimi-for-coding");

  const kimiAliases = new Set(["k2p5", "k2p6", "k2p7"]);
  const models: Model<Api>[] = [];

  for (const [modelId, m] of Object.entries(kimiModels)) {
    if (m.tool_call !== true) continue;

    if (kimiAliases.has(modelId) && hasKimiForCoding) continue;

    const normalizedId = kimiAliases.has(modelId) ? "kimi-for-coding" : modelId;

    const normalizedName = kimiAliases.has(modelId) ? "Kimi For Coding" : m.name || normalizedId;

    const isKimiK3 = normalizedId === "k3";
    const allowEmptySignature = isKimiK3 || normalizedId === "kimi-for-coding";
    const impliedCost = KIMI_CODING_IMPLIED_COSTS.get(normalizedId);
    const compat: AnthropicMessagesCompat = {};

    if (allowEmptySignature) compat.allowEmptySignature = true;
    compat.forceAdaptiveThinking = true;

    models.push({
      id: normalizedId,
      name: normalizedName,
      api: "anthropic-messages",
      provider: "kimi-coding",
      baseUrl: "https://api.kimi.com/coding",
      compat,
      reasoning: isKimiK3 || m.reasoning === true,
      input: modelInput(m),
      cost: {
        input: m.cost?.input || impliedCost?.input || 0,
        output: m.cost?.output || impliedCost?.output || 0,
        cacheRead: m.cost?.cache_read || impliedCost?.cacheRead || 0,
        cacheWrite: m.cost?.cache_write || impliedCost?.cacheWrite || 0,
      },
      contextWindow: m.limit?.context || 4096,
      maxTokens: m.limit?.output || 4096,
    });
    recordModelsDevMetadata("kimi-coding", normalizedId, m);
  }

  return models;
}

/** Moonshot's international and China APIs; Kimi K3 reasons, takes effort, and falls back to its list prices. */
export function moonshotModels(data: ModelsDevCatalog): Model<Api>[] {
  const variants = [
    { key: "moonshotai", provider: "moonshotai", baseUrl: "https://api.moonshot.ai/v1" },
    { key: "moonshotai-cn", provider: "moonshotai-cn", baseUrl: "https://api.moonshot.cn/v1" },
  ] as const;

  const moonshotCompat: OpenAICompletionsCompat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    maxTokensField: "max_tokens",
    supportsStrictMode: false,
    thinkingFormat: "deepseek",
  };

  const models: Model<Api>[] = [];

  for (const { key, provider, baseUrl } of variants) {
    for (const [modelId, m] of Object.entries(data[key]?.models ?? {})) {
      if (m.tool_call !== true) continue;

      const isKimiK3 = modelId === "kimi-k3";
      const compat = isKimiK3 ? { ...moonshotCompat } : moonshotCompat;

      if (isKimiK3) {
        compat.requiresReasoningContentOnAssistantMessages = true;
        compat.deferredToolsMode = "kimi";
        compat.thinkingFormat = "openai";
        compat.supportsReasoningEffort = true;
      }

      models.push({
        id: modelId,
        name: m.name || modelId,
        api: "openai-completions",
        provider,
        baseUrl,
        reasoning: isKimiK3 || m.reasoning === true,
        input: modelInput(m),
        cost: {
          input: m.cost?.input || (isKimiK3 ? KIMI_K3_COST.input : 0),
          output: m.cost?.output || (isKimiK3 ? KIMI_K3_COST.output : 0),
          cacheRead: m.cost?.cache_read || (isKimiK3 ? KIMI_K3_COST.cacheRead : 0),
          cacheWrite: m.cost?.cache_write || (isKimiK3 ? KIMI_K3_COST.cacheWrite : 0),
        },
        contextWindow: m.limit?.context || 4096,
        maxTokens: m.limit?.output || 4096,
        compat,
      });
      recordModelsDevMetadata(provider, modelId, m);
    }
  }

  return models;
}

/**
 * Xiaomi MiMo models. Built-in `xiaomi` targets the API billing endpoint (single stable URL,
 * keys from platform.xiaomimimo.com). The three `xiaomi-token-plan-*` providers cover prepaid
 * Token Plan endpoints in cn / ams / sgp.
 */
export function xiaomiModels(data: ModelsDevCatalog): Model<Api>[] {
  const xiaomiCompat: OpenAICompletionsCompat = {
    requiresReasoningContentOnAssistantMessages: true,
    thinkingFormat: "deepseek",
  };

  const variants = [
    { source: "xiaomi", provider: "xiaomi", baseUrl: "https://api.xiaomimimo.com/v1" },
    {
      source: "xiaomi-token-plan-cn",
      provider: "xiaomi-token-plan-cn",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    },
    {
      source: "xiaomi-token-plan-ams",
      provider: "xiaomi-token-plan-ams",
      baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
    },
    {
      source: "xiaomi-token-plan-sgp",
      provider: "xiaomi-token-plan-sgp",
      baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    },
  ] as const;

  const models: Model<Api>[] = [];

  for (const { source, provider, baseUrl } of variants) {
    for (const [modelId, m] of Object.entries(data[source]?.models ?? {})) {
      if (m.tool_call !== true) continue;

      if (m.status === "deprecated") continue;

      models.push({
        id: modelId,
        name: m.name || modelId,
        api: "openai-completions",
        provider,
        baseUrl,
        compat: xiaomiCompat,
        reasoning: m.reasoning === true,
        input: modelInput(m),
        cost: flatCost(m.cost),
        contextWindow: m.limit?.context || 4096,
        maxTokens: m.limit?.output || 4096,
      });
      recordModelsDevMetadata(provider, modelId, m);
    }
  }

  return models;
}

/**
 * Alibaba Cloud Model Studio Token Plan models. International and China use separate
 * endpoints and API keys (sk-sp- prefix). The Individual provider reuses the international
 * source and endpoint with a narrower catalog, and throws when models.dev lacks one of its
 * models. models.dev keys are "alibaba-token-plan[-cn]"; Nyte exposes them as
 * "qwen-token-plan[-cn]" plus the Individual catalog view.
 */
export function qwenTokenPlanModels(data: ModelsDevCatalog): Model<Api>[] {
  const qwenTokenPlanCompat: OpenAICompletionsCompat = {
    thinkingFormat: "qwen",
    supportsDeveloperRole: false,
    supportsStore: false,
    supportsReasoningEffort: true,
  };

  const variants = [
    {
      source: "alibaba-token-plan",
      provider: "qwen-token-plan",
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
      modelIds: undefined,
    },
    {
      source: "alibaba-token-plan",
      provider: "qwen-token-plan-individual",
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
      modelIds: QWEN_TOKEN_PLAN_INDIVIDUAL_MODEL_IDS,
    },
    {
      source: "alibaba-token-plan-cn",
      provider: "qwen-token-plan-cn",
      baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      modelIds: undefined,
    },
  ] as const;

  const models: Model<Api>[] = [];

  for (const { source, provider, baseUrl, modelIds } of variants) {
    const providerModels = data[source]?.models;
    const emittedModelIds = modelIds ? new Set<string>() : undefined;

    for (const [modelId, m] of Object.entries(providerModels ?? {})) {
      if (m.tool_call !== true) continue;

      if (QWEN_TOKEN_PLAN_EXCLUDED_MODEL_IDS.has(modelId)) continue;

      if (modelIds && !modelIds.has(modelId)) continue;

      const supportsReasoningEffort =
        !QWEN_TOKEN_PLAN_REASONING_EFFORT_UNSUPPORTED_MODEL_IDS.has(modelId);

      const qwenModel: Model<Api> = {
        id: modelId,
        name: m.name || modelId,
        api: "openai-completions",
        provider,
        baseUrl,
        compat: supportsReasoningEffort
          ? qwenTokenPlanCompat
          : { ...qwenTokenPlanCompat, supportsReasoningEffort: false },
        reasoning: m.reasoning === true,
        input: modelInput(m),
        cost: flatCost(m.cost),
        contextWindow: m.limit?.context || 4096,
        maxTokens: m.limit?.output || 4096,
      };

      if (supportsReasoningEffort) {
        qwenModel.thinkingLevelMap =
          modelId === "qwen3.8-max"
            ? QWEN_TOKEN_PLAN_QWEN38_THINKING_LEVEL_MAP
            : QWEN_TOKEN_PLAN_HIGH_MAX_THINKING_LEVEL_MAP;
      }

      models.push(qwenModel);
      emittedModelIds?.add(modelId);
      recordModelsDevMetadata(provider, modelId, m);
    }

    if (modelIds && emittedModelIds && emittedModelIds.size !== modelIds.size) {
      const missingModelIds = Array.from(modelIds).filter(
        (modelId) => !emittedModelIds.has(modelId),
      );

      throw new Error(`${provider} is missing models: ${missingModelIds.join(", ")}`);
    }
  }

  return models;
}
