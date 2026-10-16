import { Type } from "typebox";
import { object, typed } from "./typed.ts";

export const MODEL_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ThinkingLevel = Exclude<ModelThinkingLevel, "off">;

export type ModelThinkingLevel = (typeof MODEL_THINKING_LEVELS)[number];

export type ThinkingLevelMap = Partial<Record<ModelThinkingLevel, string | null>>;

export const MODEL_MODES = ["fast"] as const;

export type ModelMode = (typeof MODEL_MODES)[number];

export type KnownApi =
  | "openai-completions"
  | "mistral-conversations"
  | "openai-responses"
  | "azure-openai-responses"
  | "openai-codex-responses"
  | "anthropic-messages"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "google-vertex"
  | "pi-messages";

export type Api = KnownApi | (string & {});

export type KnownProvider =
  | "amazon-bedrock"
  | "ant-ling"
  | "anthropic"
  | "google"
  | "google-vertex"
  | "openai"
  | "azure-openai-responses"
  | "openai-codex"
  | "radius"
  | "nvidia"
  | "deepseek"
  | "github-copilot"
  | "xai"
  | "groq"
  | "cerebras"
  | "openrouter"
  | "vercel-ai-gateway"
  | "zai"
  | "zai-coding-cn"
  | "mistral"
  | "minimax"
  | "minimax-cn"
  | "moonshotai"
  | "moonshotai-cn"
  | "huggingface"
  | "fireworks"
  | "together"
  | "baseten"
  | "opencode"
  | "opencode-go"
  | "kimi-coding"
  | "cloudflare-workers-ai"
  | "cloudflare-ai-gateway"
  | "qwen-token-plan"
  | "qwen-token-plan-cn"
  | "qwen-token-plan-individual"
  | "xiaomi"
  | "xiaomi-token-plan-cn"
  | "xiaomi-token-plan-ams"
  | "xiaomi-token-plan-sgp";

export type ProviderId = KnownProvider | string;

export type ChatTemplateKwargValue =
  | string
  | number
  | boolean
  | null
  | {
      $var: "thinking.enabled" | "thinking.effort" | "thinking.budget";
      omitWhenOff?: boolean;
    };

export type ThinkingTokenBudgetField =
  | "thinking_token_budget"
  | "thinking_budget"
  | "thinking_budget_tokens";

export type SessionAffinityFormat = "openai" | "openai-nosession" | "openrouter";

export type CacheRetention = "none" | "short" | "long";

export type ModelPromptCache = Partial<Record<Exclude<CacheRetention, "none">, number>>;

export interface AnthropicAllowedFallbackModel {
  provider: ProviderId;
  model: string;
  cost: ModelCost;
}

export interface ModelCostRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCostTier extends ModelCostRates {
  inputTokensAbove: number;
}

export interface ModelCost extends ModelCostRates {
  tiers?: ModelCostTier[];
}

export interface OpenAICompletionsCompat {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  supportsFinishReason?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
  requiresReasoningContentOnAssistantMessages?: boolean;
  thinkingFormat?:
    | "openai"
    | "openrouter"
    | "deepseek"
    | "together"
    | "baseten"
    | "zai"
    | "qwen"
    | "chat-template"
    | "qwen-chat-template"
    | "string-thinking"
    | "ant-ling";
  chatTemplateKwargs?: Record<string, ChatTemplateKwargValue>;
  chatTemplateArgs?: Record<string, ChatTemplateKwargValue>;
  openRouterRouting?: OpenRouterRouting;
  vercelGatewayRouting?: VercelGatewayRouting;
  zaiToolStream?: boolean;
  thinkingTokenBudgetField?: ThinkingTokenBudgetField;
  supportsThinkingTokenBudget?: boolean;
  supportsOpenAIGrammarTools?: boolean;
  supportsMidConvoSystemMessages?: boolean;
  supportsMidConvoToolAdditions?: boolean;
  supportsStrictMode?: boolean;
  cacheControlFormat?: "anthropic";
  sendSessionAffinityHeaders?: boolean;
  deferredToolsMode?: "kimi";
  sessionAffinityFormat?: SessionAffinityFormat;
  supportsLongCacheRetention?: boolean;
}

export interface OpenAIResponsesCompat {
  supportsDeveloperRole?: boolean;
  supportsMidConvoSystemMessages?: boolean;
  sessionAffinityFormat?: SessionAffinityFormat;
  supportsLongCacheRetention?: boolean;
  supportsStrictMode?: boolean;
  supportsOpenAIGrammarTools?: boolean;
  supportsAdditionalTools?: boolean;
  supportsToolSearch?: boolean;
  supportsExplicitPromptCacheMode?: boolean;
}

export interface AnthropicMessagesCompat {
  supportsEagerToolInputStreaming?: boolean;
  supportsLongCacheRetention?: boolean;
  sendSessionAffinityHeaders?: boolean;
  supportsCacheControlOnTools?: boolean;
  supportsTemperature?: boolean;
  forceAdaptiveThinking?: boolean;
  allowEmptySignature?: boolean;
  supportsStrictTools?: boolean;
  supportsMidConvoSystemMessages?: boolean;
  supportsMidConvoToolChanges?: boolean;
  allowedFallbackModels?: AnthropicAllowedFallbackModel[];
  supportsToolReferences?: boolean;
}

export interface BedrockCompat {
  supportsStrictMode?: boolean;
}

export interface OpenRouterRouting {
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: "deny" | "allow";
  zdr?: boolean;
  enforce_distillable_text?: boolean;
  order?: string[];
  only?: string[];
  ignore?: string[];
  quantizations?: string[];
  sort?:
    | string
    | {
        by?: string;
        partition?: string | null;
      };
  max_price?: {
    prompt?: number | string;
    completion?: number | string;
    image?: number | string;
    audio?: number | string;
    request?: number | string;
  };
  preferred_min_throughput?:
    | number
    | {
        p50?: number;
        p75?: number;
        p90?: number;
        p99?: number;
      };
  preferred_max_latency?:
    | number
    | {
        p50?: number;
        p75?: number;
        p90?: number;
        p99?: number;
      };
}

export interface VercelGatewayRouting {
  only?: string[];
  order?: string[];
}

export interface Model<TApi extends Api> {
  id: string;
  name: string;
  api: TApi;
  provider: ProviderId;
  baseUrl: string;
  reasoning: boolean;
  modes?: ModelMode[];
  variant?: { mode: ModelMode; base: string };
  thinkingLevelMap?: ThinkingLevelMap;
  promptCache?: ModelPromptCache;
  input: ("text" | "image")[];
  cost: ModelCost;
  contextWindow: number;
  maxTokens: number;
  samplingParams?: Record<string, unknown>;
  headers?: Record<string, string>;
  compat?: TApi extends "openai-completions"
    ? OpenAICompletionsCompat
    : TApi extends "openai-responses" | "azure-openai-responses" | "openai-codex-responses"
      ? OpenAIResponsesCompat
      : TApi extends "anthropic-messages"
        ? AnthropicMessagesCompat
        : TApi extends "bedrock-converse-stream"
          ? BedrockCompat
          : never;
}

const nullableString = Type.Union([Type.String(), Type.Null()]);

const ModelCostRatesSchema = object({
  input: Type.Number(),
  output: Type.Number(),
  cacheRead: Type.Number(),
  cacheWrite: Type.Number(),
});

const ModelCostTierSchema = object({
  ...ModelCostRatesSchema.properties,
  inputTokensAbove: Type.Number(),
});

const ModelCostSchema = object({
  ...ModelCostRatesSchema.properties,
  tiers: Type.Optional(Type.Array(ModelCostTierSchema)),
});

const ThinkingLevelMapSchema = object({
  off: Type.Optional(nullableString),
  minimal: Type.Optional(nullableString),
  low: Type.Optional(nullableString),
  medium: Type.Optional(nullableString),
  high: Type.Optional(nullableString),
  xhigh: Type.Optional(nullableString),
  max: Type.Optional(nullableString),
});

const ModelPromptCacheSchema = object({
  short: Type.Optional(Type.Number()),
  long: Type.Optional(Type.Number()),
});

const ChatTemplateKwargValueSchema = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
  object({
    $var: Type.Union([
      Type.Literal("thinking.enabled"),
      Type.Literal("thinking.effort"),
      Type.Literal("thinking.budget"),
    ]),
    omitWhenOff: Type.Optional(Type.Boolean()),
  }),
]);

const OpenRouterRoutingSchema = object({
  allow_fallbacks: Type.Optional(Type.Boolean()),
  require_parameters: Type.Optional(Type.Boolean()),
  data_collection: Type.Optional(Type.Union([Type.Literal("deny"), Type.Literal("allow")])),
  zdr: Type.Optional(Type.Boolean()),
  enforce_distillable_text: Type.Optional(Type.Boolean()),
  order: Type.Optional(Type.Array(Type.String())),
  only: Type.Optional(Type.Array(Type.String())),
  ignore: Type.Optional(Type.Array(Type.String())),
  quantizations: Type.Optional(Type.Array(Type.String())),
  sort: Type.Optional(
    Type.Union([
      Type.String(),
      object({ by: Type.Optional(Type.String()), partition: Type.Optional(nullableString) }),
    ]),
  ),
  max_price: Type.Optional(
    object({
      prompt: Type.Optional(Type.Union([Type.Number(), Type.String()])),
      completion: Type.Optional(Type.Union([Type.Number(), Type.String()])),
      image: Type.Optional(Type.Union([Type.Number(), Type.String()])),
      audio: Type.Optional(Type.Union([Type.Number(), Type.String()])),
      request: Type.Optional(Type.Union([Type.Number(), Type.String()])),
    }),
  ),
  preferred_min_throughput: Type.Optional(
    Type.Union([
      Type.Number(),
      object({
        p50: Type.Optional(Type.Number()),
        p75: Type.Optional(Type.Number()),
        p90: Type.Optional(Type.Number()),
        p99: Type.Optional(Type.Number()),
      }),
    ]),
  ),
  preferred_max_latency: Type.Optional(
    Type.Union([
      Type.Number(),
      object({
        p50: Type.Optional(Type.Number()),
        p75: Type.Optional(Type.Number()),
        p90: Type.Optional(Type.Number()),
        p99: Type.Optional(Type.Number()),
      }),
    ]),
  ),
});

const VercelGatewayRoutingSchema = object({
  only: Type.Optional(Type.Array(Type.String())),
  order: Type.Optional(Type.Array(Type.String())),
});

const OpenAICompletionsCompatSchema = object({
  supportsStore: Type.Optional(Type.Boolean()),
  supportsDeveloperRole: Type.Optional(Type.Boolean()),
  supportsReasoningEffort: Type.Optional(Type.Boolean()),
  supportsUsageInStreaming: Type.Optional(Type.Boolean()),
  supportsFinishReason: Type.Optional(Type.Boolean()),
  maxTokensField: Type.Optional(
    Type.Union([Type.Literal("max_completion_tokens"), Type.Literal("max_tokens")]),
  ),
  requiresToolResultName: Type.Optional(Type.Boolean()),
  requiresAssistantAfterToolResult: Type.Optional(Type.Boolean()),
  requiresThinkingAsText: Type.Optional(Type.Boolean()),
  requiresReasoningContentOnAssistantMessages: Type.Optional(Type.Boolean()),
  thinkingFormat: Type.Optional(
    Type.Union([
      Type.Literal("openai"),
      Type.Literal("openrouter"),
      Type.Literal("deepseek"),
      Type.Literal("together"),
      Type.Literal("baseten"),
      Type.Literal("zai"),
      Type.Literal("qwen"),
      Type.Literal("chat-template"),
      Type.Literal("qwen-chat-template"),
      Type.Literal("string-thinking"),
      Type.Literal("ant-ling"),
    ]),
  ),
  chatTemplateKwargs: Type.Optional(Type.Record(Type.String(), ChatTemplateKwargValueSchema)),
  chatTemplateArgs: Type.Optional(Type.Record(Type.String(), ChatTemplateKwargValueSchema)),
  openRouterRouting: Type.Optional(OpenRouterRoutingSchema),
  vercelGatewayRouting: Type.Optional(VercelGatewayRoutingSchema),
  zaiToolStream: Type.Optional(Type.Boolean()),
  thinkingTokenBudgetField: Type.Optional(
    Type.Union([
      Type.Literal("thinking_token_budget"),
      Type.Literal("thinking_budget"),
      Type.Literal("thinking_budget_tokens"),
    ]),
  ),
  supportsThinkingTokenBudget: Type.Optional(Type.Boolean()),
  supportsOpenAIGrammarTools: Type.Optional(Type.Boolean()),
  supportsMidConvoSystemMessages: Type.Optional(Type.Boolean()),
  supportsMidConvoToolAdditions: Type.Optional(Type.Boolean()),
  supportsStrictMode: Type.Optional(Type.Boolean()),
  cacheControlFormat: Type.Optional(Type.Literal("anthropic")),
  sendSessionAffinityHeaders: Type.Optional(Type.Boolean()),
  deferredToolsMode: Type.Optional(Type.Literal("kimi")),
  sessionAffinityFormat: Type.Optional(
    Type.Union([
      Type.Literal("openai"),
      Type.Literal("openai-nosession"),
      Type.Literal("openrouter"),
    ]),
  ),
  supportsLongCacheRetention: Type.Optional(Type.Boolean()),
});

const OpenAIResponsesCompatSchema = object({
  supportsDeveloperRole: Type.Optional(Type.Boolean()),
  supportsMidConvoSystemMessages: Type.Optional(Type.Boolean()),
  sessionAffinityFormat: Type.Optional(
    Type.Union([
      Type.Literal("openai"),
      Type.Literal("openai-nosession"),
      Type.Literal("openrouter"),
    ]),
  ),
  supportsLongCacheRetention: Type.Optional(Type.Boolean()),
  supportsStrictMode: Type.Optional(Type.Boolean()),
  supportsOpenAIGrammarTools: Type.Optional(Type.Boolean()),
  supportsAdditionalTools: Type.Optional(Type.Boolean()),
  supportsToolSearch: Type.Optional(Type.Boolean()),
  supportsExplicitPromptCacheMode: Type.Optional(Type.Boolean()),
});

const AnthropicAllowedFallbackModelSchema = object({
  provider: Type.String(),
  model: Type.String(),
  cost: ModelCostSchema,
});

const AnthropicMessagesCompatSchema = object({
  supportsEagerToolInputStreaming: Type.Optional(Type.Boolean()),
  supportsLongCacheRetention: Type.Optional(Type.Boolean()),
  sendSessionAffinityHeaders: Type.Optional(Type.Boolean()),
  supportsCacheControlOnTools: Type.Optional(Type.Boolean()),
  supportsTemperature: Type.Optional(Type.Boolean()),
  forceAdaptiveThinking: Type.Optional(Type.Boolean()),
  allowEmptySignature: Type.Optional(Type.Boolean()),
  supportsStrictTools: Type.Optional(Type.Boolean()),
  supportsMidConvoSystemMessages: Type.Optional(Type.Boolean()),
  supportsMidConvoToolChanges: Type.Optional(Type.Boolean()),
  allowedFallbackModels: Type.Optional(Type.Array(AnthropicAllowedFallbackModelSchema)),
  supportsToolReferences: Type.Optional(Type.Boolean()),
});

const BedrockCompatSchema = object({
  supportsStrictMode: Type.Optional(Type.Boolean()),
});

export const ModelSchema = typed<Model<Api>>()(
  object({
    id: Type.String(),
    name: Type.String(),
    api: Type.String(),
    provider: Type.String(),
    baseUrl: Type.String(),
    reasoning: Type.Boolean(),
    modes: Type.Optional(Type.Array(Type.Enum(MODEL_MODES))),
    variant: Type.Optional(object({ mode: Type.Enum(MODEL_MODES), base: Type.String() })),
    thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
    promptCache: Type.Optional(ModelPromptCacheSchema),
    input: Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")])),
    cost: ModelCostSchema,
    contextWindow: Type.Number(),
    maxTokens: Type.Number(),
    samplingParams: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    compat: Type.Optional(
      Type.Union([
        OpenAICompletionsCompatSchema,
        OpenAIResponsesCompatSchema,
        AnthropicMessagesCompatSchema,
        BedrockCompatSchema,
      ]),
    ),
  }),
);
