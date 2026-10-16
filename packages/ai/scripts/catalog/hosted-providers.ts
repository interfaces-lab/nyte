/** Catalog models for providers that host or route other labs' models: inference clouds, gateways, and coding assistants. */
import {
  CLOUDFLARE_AI_GATEWAY_ANTHROPIC_BASE_URL,
  CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL,
  CLOUDFLARE_AI_GATEWAY_OPENAI_BASE_URL,
  CLOUDFLARE_WORKERS_AI_BASE_URL,
} from "../../src/api/cloudflare.ts";
import { GITHUB_COPILOT_HEADERS } from "../../src/api/github-copilot-headers.ts";
import type {
  AnthropicMessagesCompat,
  Api,
  Model,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
} from "../../src/types.ts";
import { getEffortThinkingLevelMap } from "../models-dev-reasoning-options.ts";
import { getAnthropicMessagesCompat, TOGETHER_REASONING_ONLY_MODELS } from "./compat-metadata.ts";
import {
  flatCost,
  modelInput,
  modelsDevCost,
  modelsDevModel,
  recordModelsDevMetadata,
  type ModelsDevCatalog,
  type ModelsDevProvider,
} from "./models-dev.ts";
import { NVIDIA_BASE_URL, normalizeNvidiaModelId } from "./remote-catalogs.ts";

const TOGETHER_BASE_URL = "https://api.together.ai/v1";

const TOGETHER_BASE_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
  supportsStrictMode: false,
  supportsLongCacheRetention: false,
};

const TOGETHER_TOGGLE_REASONING_COMPAT: OpenAICompletionsCompat = {
  ...TOGETHER_BASE_COMPAT,
  thinkingFormat: "together",
};

const TOGETHER_REASONING_EFFORT_COMPAT: OpenAICompletionsCompat = {
  ...TOGETHER_BASE_COMPAT,
  supportsReasoningEffort: true,
  thinkingFormat: "openai",
};

const TOGETHER_TOGGLE_REASONING_EFFORT_COMPAT: OpenAICompletionsCompat = {
  ...TOGETHER_TOGGLE_REASONING_COMPAT,
  supportsReasoningEffort: true,
};

const TOGETHER_REASONING_EFFORT_MODELS = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);

const TOGETHER_TOGGLE_REASONING_EFFORT_MODELS = new Set(["deepseek-ai/DeepSeek-V4-Pro"]);

const TOGETHER_FIXED_REASONING_LEVEL_MAP = {
  off: null,
  minimal: null,
  low: null,
  medium: null,
} as const;

const TOGETHER_REASONING_EFFORT_LEVEL_MAP = {
  off: null,
  minimal: null,
} as const;

const TOGETHER_DEEPSEEK_V4_THINKING_LEVEL_MAP = {
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: null,
} as const;

const TOGETHER_TOGGLE_REASONING_LEVEL_MAP = {
  minimal: null,
  low: null,
  medium: null,
} as const;

const NVIDIA_HEADERS = {
  "NVCF-POLL-SECONDS": "3600",
} as const;

const NVIDIA_OPENAI_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
  supportsStrictMode: false,
  supportsLongCacheRetention: false,
};

const NVIDIA_NIM_UNSUPPORTED_MODELS = new Set([
  "abacusai/dracarys-llama-3.1-70b-instruct",
  "bytedance/seed-oss-36b-instruct",
  "deepseek-ai/deepseek-v4-flash",
  "deepseek-ai/deepseek-v4-pro",
  "google/gemma-2-2b-it",
  "google/gemma-3n-e2b-it",
  "google/gemma-3n-e4b-it",
  "google/gemma-4-31b-it",
  "meta/llama-3.2-1b-instruct",
  "meta/llama-4-maverick-17b-128e-instruct",
  "microsoft/phi-4-mini-instruct",
  "minimaxai/minimax-m2.7",
  "mistralai/mistral-nemotron",
  "nvidia/nemotron-mini-4b-instruct",
  "qwen/qwen3-next-80b-a3b-instruct",
  "qwen/qwen3.5-397b-a17b",
  "sarvamai/sarvam-m",
  "upstage/solar-10.7b-instruct",
]);

const OPENCODE_OPENAI_COMPLETIONS_LONG_CACHE_RETENTION_UNSUPPORTED_MODELS = new Set([
  "opencode:deepseek-v4-flash",
  "opencode:deepseek-v4-pro",
  "opencode:kimi-k2.5",
  "opencode:kimi-k2.6",
  "opencode:minimax-m2.7",
  "opencode-go:kimi-k2.6",
]);

/** Cloudflare Workers AI models, which use session affinity headers. */
export function cloudflareWorkersAiModels(data: ModelsDevCatalog): Model<Api>[] {
  const models: Model<Api>[] = [];

  for (const [modelId, m] of Object.entries(data["cloudflare-workers-ai"]?.models ?? {})) {
    if (m.tool_call !== true) continue;

    models.push({
      ...modelsDevModel(
        modelId,
        m,
        "openai-completions",
        "cloudflare-workers-ai",
        CLOUDFLARE_WORKERS_AI_BASE_URL,
      ),
      compat: { sendSessionAffinityHeaders: true },
    });
    recordModelsDevMetadata("cloudflare-workers-ai", modelId, m);
  }

  return models;
}

/**
 * Cloudflare AI Gateway's OpenAI, Anthropic and Workers AI passthroughs, keyed `upstream/id`
 * in models.dev. The Anthropic and Workers AI passthroughs forward session affinity headers to
 * upstreams that use them for cache and routing affinity.
 */
export function cloudflareAiGatewayModels(data: ModelsDevCatalog): Model<Api>[] {
  const models: Model<Api>[] = [];

  for (const [prefixedId, m] of Object.entries(data["cloudflare-ai-gateway"]?.models ?? {})) {
    if (m.tool_call !== true) continue;

    const prefixed = /^([^/]*)\/(.*)$/su.exec(prefixedId);

    if (!prefixed) continue;
    const [, upstream, nativeId] = prefixed;

    let api: "anthropic-messages" | "openai-completions" | "openai-responses";
    let baseUrl: string;
    let id: string;

    if (upstream === "openai") {
      api = "openai-responses";
      baseUrl = CLOUDFLARE_AI_GATEWAY_OPENAI_BASE_URL;
      id = nativeId;
    } else if (upstream === "anthropic") {
      api = "anthropic-messages";
      baseUrl = CLOUDFLARE_AI_GATEWAY_ANTHROPIC_BASE_URL;
      id = nativeId;
    } else if (upstream === "workers-ai") {
      api = "openai-completions";
      baseUrl = CLOUDFLARE_AI_GATEWAY_COMPAT_BASE_URL;
      id = prefixedId;
    } else {
      continue;
    }

    const gatewayModel = modelsDevModel(id, m, api, "cloudflare-ai-gateway", baseUrl);

    if (upstream === "anthropic" || upstream === "workers-ai") {
      gatewayModel.compat = { sendSessionAffinityHeaders: true };
    }

    models.push(gatewayModel);
    recordModelsDevMetadata("cloudflare-ai-gateway", id, m);
  }

  return models;
}

/** Hugging Face Inference Providers models, which reject the developer role. */
export function huggingFaceModels(data: ModelsDevCatalog): Model<Api>[] {
  const models: Model<Api>[] = [];

  for (const [modelId, m] of Object.entries(data.huggingface?.models ?? {})) {
    if (m.tool_call !== true) continue;

    models.push({
      id: modelId,
      name: m.name || modelId,
      api: "openai-completions",
      provider: "huggingface",
      baseUrl: "https://router.huggingface.co/v1",
      reasoning: m.reasoning === true,
      input: modelInput(m),
      cost: flatCost(m.cost),
      compat: {
        supportsDeveloperRole: false,
      },
      contextWindow: m.limit?.context || 4096,
      maxTokens: m.limit?.output || 4096,
    });
    recordModelsDevMetadata("huggingface", modelId, m);
  }

  return models;
}

/**
 * Fireworks models. GLM 5.2 and Kimi K3 go over Chat Completions; the rest over Fireworks'
 * Anthropic-compatible API, where the SDK appends /v1/messages. Fireworks prompt caching uses
 * automatic prefix matching plus session affinity: x-session-affinity routes requests to the
 * same replica for cache hits, and cache_control on tools and eager_input_streaming are not
 * supported. See https://docs.fireworks.ai/tools-sdks/anthropic-compatibility
 */
export function fireworksModels(provider: ModelsDevProvider | undefined): Model<Api>[] {
  if (!provider?.models) return [];

  const anthropicCompat: AnthropicMessagesCompat = {
    sendSessionAffinityHeaders: true,
    supportsEagerToolInputStreaming: false,
    supportsCacheControlOnTools: false,
    supportsLongCacheRetention: false,
  };

  const openAICompat: OpenAICompletionsCompat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    sendSessionAffinityHeaders: true,
    supportsLongCacheRetention: false,
  };

  const kimiK3Compat: OpenAICompletionsCompat = {
    ...openAICompat,
    requiresReasoningContentOnAssistantMessages: true,
    thinkingFormat: "openai",
    deferredToolsMode: "kimi",
  };

  const models: Model<Api>[] = [];

  for (const [modelId, model] of Object.entries(provider.models)) {
    if (model.tool_call !== true) continue;

    const common = {
      id: modelId,
      name: model.name || modelId,
      provider: "fireworks",
      reasoning: model.reasoning === true,
      input: modelInput(model),
      cost: flatCost(model.cost),
      contextWindow: model.limit?.context || 4096,
      maxTokens: model.limit?.output || 4096,
    };

    if (modelId.includes("glm-5p2")) {
      models.push({
        ...common,
        api: "openai-completions",
        baseUrl: "https://api.fireworks.ai/inference/v1",
        compat: openAICompat,
      });
    } else if (modelId.includes("kimi-k3")) {
      models.push({
        ...common,
        api: "openai-completions",
        baseUrl: "https://api.fireworks.ai/inference/v1",
        compat: kimiK3Compat,
      });
    } else {
      models.push({
        ...common,
        api: "anthropic-messages",
        baseUrl: "https://api.fireworks.ai/inference",
        compat: anthropicCompat,
      });
    }

    recordModelsDevMetadata("fireworks", modelId, model);
  }

  return models;
}

/** NVIDIA NIM text models that NIM's live list serves under models.dev's id or its normalized spelling. */
export function nvidiaModels(
  data: ModelsDevCatalog,
  nimModelIds: ReadonlyMap<string, string>,
): Model<Api>[] {
  const models: Model<Api>[] = [];

  for (const [modelId, m] of Object.entries(data.nvidia?.models ?? {})) {
    if (m.tool_call !== true) continue;

    if (!m.modalities?.input?.includes("text")) continue;

    if (!m.modalities?.output?.includes("text")) continue;

    const liveModelId =
      nimModelIds.get(modelId) ?? nimModelIds.get(normalizeNvidiaModelId(modelId));

    if (!liveModelId) continue;

    if (NVIDIA_NIM_UNSUPPORTED_MODELS.has(liveModelId)) continue;

    models.push({
      id: liveModelId,
      name: m.name || liveModelId,
      api: "openai-completions",
      provider: "nvidia",
      baseUrl: NVIDIA_BASE_URL,
      headers: { ...NVIDIA_HEADERS },
      reasoning: m.reasoning === true,
      input: m.modalities.input.includes("image") ? ["text", "image"] : ["text"],
      cost: flatCost(m.cost),
      compat: NVIDIA_OPENAI_COMPAT,
      contextWindow: m.limit?.context || 4096,
      maxTokens: m.limit?.output || 4096,
    });
    recordModelsDevMetadata("nvidia", liveModelId, m);
  }

  return models;
}

function getTogetherCompat(modelId: string, reasoning: boolean): OpenAICompletionsCompat {
  if (!reasoning) return TOGETHER_BASE_COMPAT;

  if (TOGETHER_REASONING_EFFORT_MODELS.has(modelId)) return TOGETHER_REASONING_EFFORT_COMPAT;

  if (TOGETHER_TOGGLE_REASONING_EFFORT_MODELS.has(modelId))
    return TOGETHER_TOGGLE_REASONING_EFFORT_COMPAT;

  if (TOGETHER_REASONING_ONLY_MODELS.has(modelId)) return TOGETHER_BASE_COMPAT;

  return TOGETHER_TOGGLE_REASONING_COMPAT;
}

function getTogetherThinkingLevelMap(
  modelId: string,
  reasoning: boolean,
): NonNullable<Model<Api>["thinkingLevelMap"]> | undefined {
  if (!reasoning) return undefined;

  if (TOGETHER_REASONING_EFFORT_MODELS.has(modelId))
    return { ...TOGETHER_REASONING_EFFORT_LEVEL_MAP };

  if (TOGETHER_TOGGLE_REASONING_EFFORT_MODELS.has(modelId))
    return { ...TOGETHER_DEEPSEEK_V4_THINKING_LEVEL_MAP };

  if (TOGETHER_REASONING_ONLY_MODELS.has(modelId)) return { ...TOGETHER_FIXED_REASONING_LEVEL_MAP };

  return { ...TOGETHER_TOGGLE_REASONING_LEVEL_MAP };
}

/** Together AI's current models, under whichever key models.dev lists them. */
export function togetherModels(data: ModelsDevCatalog): Model<Api>[] {
  const togetherProvider = data.together ?? data.togetherai ?? data["together-ai"];
  const models: Model<Api>[] = [];

  for (const [modelId, m] of Object.entries(togetherProvider?.models ?? {})) {
    if (m.tool_call !== true) continue;

    if (m.status === "deprecated") continue;

    const reasoning = m.reasoning === true;
    const thinkingLevelMap = getTogetherThinkingLevelMap(modelId, reasoning);

    const togetherModel: Model<Api> = {
      id: modelId,
      name: m.name || modelId,
      api: "openai-completions",
      provider: "together",
      baseUrl: TOGETHER_BASE_URL,
      reasoning,
      input: modelInput(m),
      cost: flatCost(m.cost),
      compat: getTogetherCompat(modelId, reasoning),
      contextWindow: m.limit?.context || 4096,
      maxTokens: m.limit?.output || 4096,
    };

    if (thinkingLevelMap) togetherModel.thinkingLevelMap = thinkingLevelMap;
    models.push(togetherModel);
    recordModelsDevMetadata("together", modelId, m);
  }

  return models;
}

/** Baseten's current models, with thinking toggles passed as a chat-template argument. */
export function basetenModels(provider: ModelsDevProvider | undefined): Model<Api>[] {
  if (!provider?.models) return [];

  const baseUrl = "https://inference.baseten.co/v1";

  const baseCompat: OpenAICompletionsCompat = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: true,
    maxTokensField: "max_tokens",
    supportsStrictMode: true,
    supportsLongCacheRetention: false,
  };

  const reasoningEffortCompat: OpenAICompletionsCompat = {
    ...baseCompat,
    supportsReasoningEffort: true,
    thinkingFormat: "openai",
  };

  const toggleReasoningCompat: OpenAICompletionsCompat = {
    ...baseCompat,
    thinkingFormat: "baseten",
    chatTemplateArgs: { enable_thinking: { $var: "thinking.enabled" } },
  };

  const toggleReasoningEffortCompat: OpenAICompletionsCompat = {
    ...reasoningEffortCompat,
    thinkingFormat: "baseten",
    chatTemplateArgs: { enable_thinking: { $var: "thinking.enabled" } },
  };

  const toggleThinkingLevelMap = {
    off: "off",
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    xhigh: null,
    max: null,
  } as const;

  const glm52ThinkingLevelMap = {
    off: "none",
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    xhigh: null,
    max: "max",
  } as const;

  const models: Model<Api>[] = [];

  for (const [modelId, model] of Object.entries(provider.models)) {
    if (model.status === "deprecated") continue;

    const reasoning = model.reasoning === true;
    const reasoningOptions = model.reasoning_options ?? [];
    const isGlm52 = modelId === "zai-org/GLM-5.2" || modelId === "zai-org/GLM-5.2-Fast";
    const supportsToggle = reasoningOptions.some((option) => option.type === "toggle") || isGlm52;
    const supportsEffort = reasoningOptions.some((option) => option.type === "effort") || isGlm52;

    const compat =
      supportsToggle && supportsEffort
        ? toggleReasoningEffortCompat
        : supportsToggle
          ? toggleReasoningCompat
          : supportsEffort
            ? reasoningEffortCompat
            : baseCompat;

    const thinkingLevelMap = isGlm52
      ? glm52ThinkingLevelMap
      : supportsToggle
        ? toggleThinkingLevelMap
        : getEffortThinkingLevelMap(reasoningOptions);

    const basetenModel: Model<Api> = {
      id: modelId,
      name: model.name || modelId,
      api: "openai-completions",
      provider: "baseten",
      baseUrl,
      reasoning,
      input: modelInput(model),
      cost: flatCost(model.cost),
      compat,
      contextWindow: model.limit?.context || 4096,
      maxTokens: model.limit?.output || 4096,
    };

    if (thinkingLevelMap) basetenModel.thinkingLevelMap = thinkingLevelMap;
    models.push(basetenModel);
  }

  return models;
}

/**
 * OpenCode Zen and Go models. The API follows models.dev's `provider.npm`: @ai-sdk/openai is
 * openai-responses, @ai-sdk/anthropic is anthropic-messages (the SDK appends /v1/messages to
 * the base URL), @ai-sdk/google is google-generative-ai, and anything else, including none or
 * @ai-sdk/openai-compatible, is openai-completions. Corrections over that data:
 * - OpenCode Kimi K2.6 accepts Anthropic-style thinking objects and rejects string thinking
 *   values or combined reasoning_effort.
 * - models.dev reports OpenCode Go's MiniMax M2.7 and Qwen 3.5/3.6 Plus as @ai-sdk/anthropic,
 *   but those endpoints either don't accept Anthropic SDK auth (MiniMax M2.7) or are served
 *   through the OpenAI-compatible /v1/chat/completions path (Qwen), so they use
 *   openai-completions with Bearer auth. Qwen/DashScope reads enable_thinking at the top level.
 */
export function opencodeModels(data: ModelsDevCatalog): Model<Api>[] {
  const variants = [
    {
      key: "opencode",
      provider: "opencode",
      basePath: "https://opencode.ai/zen",
      servesGemini: true,
    },
    {
      key: "opencode-go",
      provider: "opencode-go",
      basePath: "https://opencode.ai/zen/go",
      servesGemini: false,
    },
  ] as const;

  const models: Model<Api>[] = [];

  for (const variant of variants) {
    const providerModels = data[variant.key]?.models;

    if (!providerModels) continue;

    for (const [modelId, m] of Object.entries(providerModels)) {
      if (m.tool_call !== true) continue;

      if (m.status === "deprecated") continue;

      const npm = m.provider?.npm;
      let api: Api;
      let baseUrl: string;
      let compat: OpenAICompletionsCompat | OpenAIResponsesCompat | undefined;

      if (npm === "@ai-sdk/openai") {
        api = "openai-responses";
        baseUrl = `${variant.basePath}/v1`;
        compat = { sessionAffinityFormat: "openai-nosession" };
      } else if (npm === "@ai-sdk/anthropic") {
        api = "anthropic-messages";
        baseUrl = variant.basePath;
      } else if (npm === "@ai-sdk/google") {
        if (!variant.servesGemini) continue;
        api = "google-generative-ai";
        baseUrl = `${variant.basePath}/v1`;
      } else if (npm === "@ai-sdk/alibaba") {
        api = "openai-completions";
        baseUrl = `${variant.basePath}/v1`;
        compat = { cacheControlFormat: "anthropic" };
      } else {
        api = "openai-completions";
        baseUrl = `${variant.basePath}/v1`;
      }

      if (variant.provider === "opencode" && modelId === "grok-build-0.1") {
        compat = { ...(compat ?? {}), supportsReasoningEffort: false };
      }

      if (
        (variant.provider === "opencode" || variant.provider === "opencode-go") &&
        modelId === "kimi-k2.6"
      ) {
        compat = {
          ...(compat ?? {}),
          thinkingFormat: "deepseek",
          supportsReasoningEffort: false,
        };
      }

      if (variant.provider === "opencode-go") {
        if (modelId === "minimax-m2.7") {
          api = "openai-completions";
          baseUrl = `${variant.basePath}/v1`;
        }

        if (modelId === "qwen3.5-plus" || modelId === "qwen3.6-plus") {
          api = "openai-completions";
          baseUrl = `${variant.basePath}/v1`;
          compat = { ...(compat ?? {}), thinkingFormat: "qwen" };
        }
      }

      if (api === "openai-completions") {
        compat = { ...(compat ?? {}), maxTokensField: "max_tokens" };

        if (
          OPENCODE_OPENAI_COMPLETIONS_LONG_CACHE_RETENTION_UNSUPPORTED_MODELS.has(
            `${variant.provider}:${modelId}`,
          )
        ) {
          compat = { ...compat, supportsLongCacheRetention: false };
        }
      }

      const opencodeModel: Model<Api> = {
        id: modelId,
        name: m.name || modelId,
        api,
        provider: variant.provider,
        baseUrl,
        reasoning: m.reasoning === true,
        input: modelInput(m),
        cost: modelsDevCost(m.cost),
        contextWindow: m.limit?.context || 4096,
        maxTokens: m.limit?.output || 4096,
      };

      if (compat) opencodeModel.compat = compat;
      models.push(opencodeModel);
      recordModelsDevMetadata(variant.provider, modelId, m);
    }
  }

  return models;
}

/**
 * GitHub Copilot models. Claude 4.x and 5.x route to the Anthropic Messages API; GPT, Grok,
 * OSWE, and MAI-Code models are only served through the Copilot /responses endpoint; the rest
 * use Chat Completions.
 */
export function githubCopilotModels(data: ModelsDevCatalog): Model<Api>[] {
  const models: Model<Api>[] = [];

  for (const [modelId, m] of Object.entries(data["github-copilot"]?.models ?? {})) {
    if (m.tool_call !== true) continue;

    if (m.status === "deprecated") continue;

    const isCopilotClaude = /^claude-(haiku|sonnet|opus|fable)-[45]([.\-]|$)/.test(modelId);

    const needsResponsesApi =
      modelId.startsWith("gpt-") ||
      modelId.startsWith("grok-") ||
      modelId.startsWith("oswe") ||
      modelId.startsWith("mai-");

    const api: Api = isCopilotClaude
      ? "anthropic-messages"
      : needsResponsesApi
        ? "openai-responses"
        : "openai-completions";

    const anthropicCompat =
      api === "anthropic-messages"
        ? getAnthropicMessagesCompat("github-copilot", modelId)
        : undefined;

    const copilotModel: Model<Api> = {
      id: modelId,
      name: m.name || modelId,
      api,
      provider: "github-copilot",
      baseUrl: "https://api.individual.githubcopilot.com",
      reasoning: m.reasoning === true,
      input: modelInput(m),
      cost: modelsDevCost(m.cost),
      contextWindow: m.limit?.context || 128000,
      maxTokens: m.limit?.output || 8192,
      headers: { ...GITHUB_COPILOT_HEADERS },
    };

    if (anthropicCompat) copilotModel.compat = anthropicCompat;

    if (api === "openai-completions") {
      copilotModel.compat = {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      };
    }

    models.push(copilotModel);
    recordModelsDevMetadata("github-copilot", modelId, m);
  }

  return models;
}
