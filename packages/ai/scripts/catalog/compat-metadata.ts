/** Compatibility, transcript and prompt-cache metadata the generator derives for each catalog model. */
import { isDeepStrictEqual } from "util";
import type {
  AnthropicMessagesCompat,
  Api,
  Model,
  ModelPromptCache,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
} from "../../src/types.ts";
import type { ModelsDevMetadata } from "./models-dev.ts";

export const OPENAI_DAYBREAK_BLUE_MODEL_ID = "gpt-daybreak-blue-latest";

/** Whether a model id names Daybreak Blue, by its own name or its `-latest` alias. */
export function namesDaybreakBlue(modelId: string): boolean {
  return modelId === "gpt-daybreak-blue" || modelId === OPENAI_DAYBREAK_BLUE_MODEL_ID;
}

const OPENAI_TOOL_SEARCH_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-pro",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
  OPENAI_DAYBREAK_BLUE_MODEL_ID,
]);

/**
 * Public OpenAI documents additional_tools for applications that load tools
 * outside the normal tool-search flow. Codex currently uses the input item for
 * its Responses Lite GPT-5.6 models.
 * https://developers.openai.com/api/docs/guides/tools-tool-search#add-tools-at-a-specific-point-in-the-input
 */
const OPENAI_ADDITIONAL_TOOLS_MODEL_IDS = OPENAI_TOOL_SEARCH_MODEL_IDS;

const OPENAI_MID_CONVO_SYSTEM_MESSAGE_MODEL_IDS = OPENAI_TOOL_SEARCH_MODEL_IDS;

const OPENAI_CODEX_ADDITIONAL_TOOLS_MODEL_IDS = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
  OPENAI_DAYBREAK_BLUE_MODEL_ID,
]);

export const TOGETHER_REASONING_ONLY_MODELS = new Set([
  "deepseek-ai/DeepSeek-R1",
  "MiniMaxAI/MiniMax-M2.7",
]);

const EAGER_TOOL_INPUT_STREAMING_UNSUPPORTED_ANTHROPIC_MODELS = new Set([
  "github-copilot:claude-haiku-4.5",
  "github-copilot:claude-sonnet-4",
  "github-copilot:claude-sonnet-4.5",
]);

const ANTHROPIC_ALLOWED_FALLBACK_MODELS = {
  "claude-fable-5": ["claude-opus-4-8", "claude-opus-5"],
  "claude-opus-5": ["claude-opus-4-8"],
} satisfies Record<string, string[]>;

function supportsAnthropicMidConvoSystemMessages(modelId: string): boolean {
  return (
    /^claude-opus-(?:4[.-]8|5(?:[.-]5)?)(?:-\d{8})?$/.test(modelId) ||
    /^claude-sonnet-5[.-]5(?:-\d{8})?$/.test(modelId) ||
    /^claude-(?:fable|mythos)-5(?:[.-]1)?(?:-\d{8})?$/.test(modelId)
  );
}

type OpenAICompletionsResolvedCompat = Required<
  Omit<
    OpenAICompletionsCompat,
    | "cacheControlFormat"
    | "deferredToolsMode"
    | "supportsThinkingTokenBudget"
    | "thinkingTokenBudgetField"
    | "sessionAffinityFormat"
  >
> & {
  cacheControlFormat?: OpenAICompletionsCompat["cacheControlFormat"];
  deferredToolsMode?: OpenAICompletionsCompat["deferredToolsMode"];
};

const OPENAI_COMPLETIONS_DEFAULT_COMPAT: OpenAICompletionsResolvedCompat = {
  supportsStore: true,
  supportsDeveloperRole: true,
  supportsReasoningEffort: true,
  supportsUsageInStreaming: true,
  supportsFinishReason: true,
  maxTokensField: "max_completion_tokens",
  requiresToolResultName: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false,
  requiresReasoningContentOnAssistantMessages: false,
  thinkingFormat: "openai",
  openRouterRouting: {},
  vercelGatewayRouting: {},
  chatTemplateKwargs: {},
  chatTemplateArgs: {},
  zaiToolStream: false,
  supportsStrictMode: false,
  supportsOpenAIGrammarTools: false,
  supportsMidConvoSystemMessages: false,
  supportsMidConvoToolAdditions: false,
  sendSessionAffinityHeaders: false,
  supportsLongCacheRetention: true,
};

const OPENAI_COMPLETIONS_DEFAULT_VALUES = new Map<string, unknown>(
  Object.entries(OPENAI_COMPLETIONS_DEFAULT_COMPAT),
);

export function mergeAnthropicMessagesCompat(
  model: Model<Api>,
  compat: AnthropicMessagesCompat,
): void {
  model.compat = { ...model.compat, ...compat };
}

/**
 * The Chat Completions behavior a provider's endpoint has, detected from its id and base URL.
 * `supportsStrictMode` preserves built-in behavior as explicit metadata against the
 * conservative runtime default.
 */
export function detectOpenAICompletionsCompat(model: Model<Api>): OpenAICompletionsResolvedCompat {
  const provider = model.provider;
  const baseUrl = model.baseUrl;

  const isZai =
    provider === "zai" ||
    provider === "zai-coding-cn" ||
    baseUrl.includes("api.z.ai") ||
    baseUrl.includes("open.bigmodel.cn");

  const isTogether =
    provider === "together" ||
    baseUrl.includes("api.together.ai") ||
    baseUrl.includes("api.together.xyz");

  const isMoonshot =
    provider === "moonshotai" || provider === "moonshotai-cn" || baseUrl.includes("api.moonshot.");

  const isOpenRouter = provider === "openrouter" || baseUrl.includes("openrouter.ai");

  const isCloudflareWorkersAI =
    provider === "cloudflare-workers-ai" || baseUrl.includes("api.cloudflare.com");

  const isCloudflareAiGateway =
    provider === "cloudflare-ai-gateway" || baseUrl.includes("gateway.ai.cloudflare.com");

  const isNvidia = provider === "nvidia" || baseUrl.includes("integrate.api.nvidia.com");
  const isAntLing = provider === "ant-ling" || baseUrl.includes("api.ant-ling.com");
  const isCerebras = provider === "cerebras" || baseUrl.includes("cerebras.ai");
  const isTogetherReasoningOnly = isTogether && TOGETHER_REASONING_ONLY_MODELS.has(model.id);
  const isDeepSeek = provider === "deepseek" || baseUrl.toLowerCase().includes("deepseek.com");

  const isNonStandard =
    isNvidia ||
    isCerebras ||
    provider === "xai" ||
    baseUrl.includes("api.x.ai") ||
    isTogether ||
    baseUrl.includes("chutes.ai") ||
    isDeepSeek ||
    isZai ||
    isMoonshot ||
    provider === "opencode" ||
    baseUrl.includes("opencode.ai") ||
    isCloudflareWorkersAI ||
    isCloudflareAiGateway ||
    isAntLing;

  const useMaxTokens =
    baseUrl.includes("chutes.ai") ||
    isDeepSeek ||
    isMoonshot ||
    isCloudflareAiGateway ||
    isTogether ||
    isNvidia ||
    isAntLing ||
    isZai;

  const isGrok = provider === "xai" || baseUrl.includes("api.x.ai");

  const isOpenRouterDeveloperRoleModel =
    isOpenRouter && (model.id.startsWith("anthropic/") || model.id.startsWith("openai/"));

  const cacheControlFormat =
    provider === "openrouter" && /^~?anthropic\//.test(model.id) ? "anthropic" : undefined;

  return {
    supportsStore: !isNonStandard,
    supportsDeveloperRole: isOpenRouterDeveloperRoleModel || (!isNonStandard && !isOpenRouter),
    supportsReasoningEffort:
      !isGrok &&
      !isZai &&
      !isMoonshot &&
      !isTogether &&
      !isCloudflareAiGateway &&
      !isNvidia &&
      !isAntLing,
    supportsUsageInStreaming: true,
    supportsFinishReason: true,
    maxTokensField: useMaxTokens ? "max_tokens" : "max_completion_tokens",
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    requiresReasoningContentOnAssistantMessages: isDeepSeek,
    thinkingFormat: isDeepSeek
      ? "deepseek"
      : isZai
        ? "zai"
        : isTogether && !isTogetherReasoningOnly
          ? "together"
          : isAntLing
            ? "ant-ling"
            : isOpenRouter
              ? "openrouter"
              : "openai",
    openRouterRouting: {},
    vercelGatewayRouting: {},
    chatTemplateKwargs: {},
    chatTemplateArgs: {},
    zaiToolStream: false,
    supportsStrictMode:
      !isMoonshot && !isTogether && !isCloudflareAiGateway && !isNvidia && !isCerebras,
    supportsOpenAIGrammarTools: false,
    supportsMidConvoSystemMessages: false,
    supportsMidConvoToolAdditions: false,
    cacheControlFormat,
    sendSessionAffinityHeaders: false,
    supportsLongCacheRetention: !(
      isTogether ||
      isCloudflareWorkersAI ||
      isCloudflareAiGateway ||
      isNvidia ||
      isAntLing
    ),
  };
}

function openAICompletionsCompatDelta(
  compat: OpenAICompletionsResolvedCompat,
): OpenAICompletionsCompat {
  const delta: OpenAICompletionsCompat = {};

  for (const [key, value] of Object.entries(compat)) {
    const defaultValue = OPENAI_COMPLETIONS_DEFAULT_VALUES.get(key);

    if (isDeepStrictEqual(value, defaultValue)) continue;

    Object.assign(delta, { [key]: value });
  }

  return delta;
}

export function applyOpenAICompletionsCompatMetadata(model: Model<Api>): void {
  if (model.api !== "openai-completions") return;

  const detected = openAICompletionsCompatDelta(detectOpenAICompletionsCompat(model));

  model.compat = { ...detected, ...model.compat };

  if (Object.keys(model.compat).length === 0) {
    delete model.compat;
  }
}

/**
 * The Anthropic Messages behavior a provider's model has. OpenCode Zen and GitHub Copilot
 * forward mid-conversation system messages but reject `tool_addition`/`tool_removal` blocks,
 * so tool changes stay top-level there. OpenCode Qwen 3.8 Flash emits and accepts thinking
 * blocks with empty signatures.
 */
export function getAnthropicMessagesCompat(
  provider: string,
  modelId: string,
): AnthropicMessagesCompat | undefined {
  const compat: AnthropicMessagesCompat = {};

  if (provider === "anthropic" && supportsAnthropicMidConvoSystemMessages(modelId)) {
    compat.supportsMidConvoSystemMessages = true;
    compat.supportsMidConvoToolChanges = true;
  }

  if (
    (provider === "opencode" || provider === "github-copilot") &&
    supportsAnthropicMidConvoSystemMessages(modelId)
  ) {
    compat.supportsMidConvoSystemMessages = true;
  }

  if (EAGER_TOOL_INPUT_STREAMING_UNSUPPORTED_ANTHROPIC_MODELS.has(`${provider}:${modelId}`)) {
    compat.supportsEagerToolInputStreaming = false;
  }

  if (provider === "xiaomi" || provider.startsWith("xiaomi-token-plan-")) {
    compat.allowEmptySignature = true;
  }

  if ((provider === "opencode" || provider === "opencode-go") && modelId === "qwen3.8-flash") {
    compat.allowEmptySignature = true;
  }

  return Object.keys(compat).length > 0 ? compat : undefined;
}

export function applyAnthropicMessagesCompatMetadata(model: Model<Api>): void {
  if (model.api !== "anthropic-messages") return;
  const compat = getAnthropicMessagesCompat(model.provider, model.id);

  if (compat) {
    mergeAnthropicMessagesCompat(model, compat);
  }
}

/** Whether a direct Anthropic model has fallbacks or serves as one. */
export function inAnthropicFallbackChain(model: Model<Api>): model is Model<"anthropic-messages"> {
  if (model.provider !== "anthropic" || model.api !== "anthropic-messages") return false;

  return (
    model.id in ANTHROPIC_ALLOWED_FALLBACK_MODELS ||
    Object.values(ANTHROPIC_ALLOWED_FALLBACK_MODELS).some((fallbackModelIds) =>
      fallbackModelIds.includes(model.id),
    )
  );
}

export function applyAnthropicAllowedFallbackModelMetadata(
  models: readonly Model<"anthropic-messages">[],
): void {
  const modelsById = new Map(models.map((model) => [model.id, model]));

  for (const [modelId, fallbackModelIds] of Object.entries(ANTHROPIC_ALLOWED_FALLBACK_MODELS)) {
    const model = modelsById.get(modelId);

    if (!model) continue;

    const allowedFallbackModels = fallbackModelIds.flatMap((fallbackModelId) => {
      const fallbackModel = modelsById.get(fallbackModelId);

      return fallbackModel
        ? [{ provider: fallbackModel.provider, model: fallbackModel.id, cost: fallbackModel.cost }]
        : [];
    });

    if (allowedFallbackModels.length > 0) {
      mergeAnthropicMessagesCompat(model, { allowedFallbackModels });
    }
  }
}

export function applyStrictToolCompatMetadata(model: Model<Api>): void {
  if (
    (model.provider === "openai" || model.provider === "cloudflare-ai-gateway") &&
    model.api === "openai-responses"
  ) {
    model.compat = {
      ...model.compat,
      supportsStrictMode: true,
    };
  } else if (model.provider === "anthropic" && model.api === "anthropic-messages") {
    mergeAnthropicMessagesCompat(model, { supportsStrictTools: true });
  }
}

/**
 * Responses endpoints verified (OpenAI, ChatGPT Codex backend, GitHub Copilot,
 * opencode zen) or documented (Azure OpenAI, Cloudflare AI Gateway) to pass
 * OpenAI custom grammar tools through. OpenAI rejects `type: "custom"` tools
 * for pre-GPT-5 models (gpt-4.x, gpt-4o, o-series).
 */
const OPENAI_GRAMMAR_TOOL_PROVIDERS = new Set([
  "openai",
  "openai-codex",
  "azure-openai-responses",
  "github-copilot",
  "opencode",
  "cloudflare-ai-gateway",
]);

const OPENAI_GRAMMAR_TOOL_APIS = new Set<Api>([
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
]);

export function applyOpenAIGrammarToolCompatMetadata(model: Model<Api>): void {
  if (
    !OPENAI_GRAMMAR_TOOL_APIS.has(model.api) ||
    !OPENAI_GRAMMAR_TOOL_PROVIDERS.has(model.provider)
  )
    return;
  const match = /^gpt-(\d+)/.exec(model.id);

  if (!(namesDaybreakBlue(model.id) || (match && Number(match[1]) >= 5))) return;
  model.compat = {
    ...model.compat,
    supportsOpenAIGrammarTools: true,
  };
}

export function applyOpenAIToolSearchMetadata(model: Model<Api>): void {
  const isOpenAIResponses = model.provider === "openai" && model.api === "openai-responses";
  const isOpenAICodex = model.provider === "openai-codex" && model.api === "openai-codex-responses";

  if (!(isOpenAIResponses || isOpenAICodex) || !OPENAI_TOOL_SEARCH_MODEL_IDS.has(model.id)) return;

  const supportsAdditionalTools =
    (isOpenAIResponses && OPENAI_ADDITIONAL_TOOLS_MODEL_IDS.has(model.id)) ||
    (isOpenAICodex && OPENAI_CODEX_ADDITIONAL_TOOLS_MODEL_IDS.has(model.id));

  const compat: OpenAIResponsesCompat = { ...model.compat };

  if (supportsAdditionalTools) compat.supportsAdditionalTools = true;
  compat.supportsToolSearch = true;
  model.compat = compat;
}

/**
 * Moonshot Kimi K2.6/K2.7 accept system text after the conversation starts but reject
 * tool-bearing system messages. Kimi K3 accepts both forms; Fireworks and OpenCode pass
 * its tool-bearing form through. GitHub Copilot forwards K3 text but silently drops its
 * tool-bearing message. DeepSeek V4 Pro and OpenAI models behind OpenRouter also accept
 * plain system text in place.
 */
export function applyOpenAICompletionsTranscriptMetadata(model: Model<Api>): void {
  if (model.api !== "openai-completions") return;

  const isKimiK3 =
    (model.provider.startsWith("moonshot") && model.id === "kimi-k3") ||
    (model.provider === "fireworks" && model.id.includes("kimi-k3")) ||
    ((model.provider === "opencode" || model.provider === "opencode-go") && model.id === "kimi-k3");

  const isMoonshotKimiK2 =
    model.provider.startsWith("moonshot") &&
    (model.id === "kimi-k2.6" ||
      model.id === "kimi-k2.7-code" ||
      model.id === "kimi-k2.7-code-highspeed");

  const isTextOnly =
    isMoonshotKimiK2 ||
    (model.provider === "github-copilot" && model.id === "kimi-k3") ||
    (model.provider === "deepseek" && model.id === "deepseek-v4-pro") ||
    (model.provider === "openrouter" &&
      model.id.startsWith("openai/") &&
      OPENAI_MID_CONVO_SYSTEM_MESSAGE_MODEL_IDS.has(model.id.slice("openai/".length)));

  if (!isKimiK3 && !isTextOnly) return;
  model.compat = {
    ...model.compat,
    supportsMidConvoSystemMessages: true,
    ...(isKimiK3 ? { supportsMidConvoToolAdditions: true } : {}),
  };
}

/**
 * Newer OpenAI Responses models accept developer messages after the conversation has started.
 * OpenCode Zen, OpenCode Go, and GitHub Copilot pass both those messages and
 * `additional_tools` items through to OpenAI unchanged; tool search is not verified
 * through those proxies.
 */
const OPENAI_RESPONSES_PROXY_PROVIDERS = new Set(["opencode", "opencode-go", "github-copilot"]);

export function applyOpenAIResponsesTranscriptMetadata(model: Model<Api>): void {
  const isOpenAIResponses = model.provider === "openai" && model.api === "openai-responses";
  const isOpenAICodex = model.provider === "openai-codex" && model.api === "openai-codex-responses";

  const isProxiedResponses =
    OPENAI_RESPONSES_PROXY_PROVIDERS.has(model.provider) && model.api === "openai-responses";

  if (
    !(isOpenAIResponses || isOpenAICodex || isProxiedResponses) ||
    !OPENAI_MID_CONVO_SYSTEM_MESSAGE_MODEL_IDS.has(model.id)
  ) {
    return;
  }

  model.compat = {
    ...model.compat,
    supportsMidConvoSystemMessages: true,
    ...(isProxiedResponses ? { supportsAdditionalTools: true } : {}),
  };
}

/**
 * OpenAI charges prompt-cache writes starting with the GPT-5.6 family, and exactly
 * those models accept `prompt_cache_options`; older models reject the parameter.
 * https://developers.openai.com/api/docs/guides/prompt-caching
 */
export function applyOpenAIExplicitPromptCacheMetadata(model: Model<Api>): void {
  if (model.provider !== "openai" || model.api !== "openai-responses") return;

  if (!(model.cost.cacheWrite > 0)) return;
  model.compat = {
    ...model.compat,
    supportsExplicitPromptCacheMode: true,
  };
}

/**
 * Anthropic ephemeral entries have a hard five-minute lifetime; `ttl: "1h"`
 * extends it to one hour. Only direct Anthropic is annotated so cache warming
 * does not assume equivalent behavior through proxies.
 * https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 */
const ANTHROPIC_PROMPT_CACHE: ModelPromptCache = { short: 300, long: 3600 };

/**
 * Annotates prompt-cache lifetimes. OpenAI gets none yet: before enabling warming for
 * explicit OpenAI caches, re-evaluate it using observed expiry, replay, and billing
 * behavior; a documented TTL alone does not establish full cache loss.
 */
export function applyPromptCacheMetadata(model: Model<Api>): void {
  if (model.provider === "anthropic" && model.api === "anthropic-messages") {
    model.promptCache = ANTHROPIC_PROMPT_CACHE;
  }
}

/** Copies models.dev's fast mode onto direct Anthropic and OpenAI models, Codex reading OpenAI's. */
export function applyModelsDevModeMetadata(model: Model<Api>, metadata: ModelsDevMetadata): void {
  const provider = model.provider === "openai-codex" ? "openai" : model.provider;

  if (provider !== "anthropic" && provider !== "openai") return;
  const modes = metadata.findModes(`${provider}:${model.id}`);

  if (modes) model.modes = [...modes];
}
