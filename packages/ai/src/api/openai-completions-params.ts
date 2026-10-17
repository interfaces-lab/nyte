/**
 * The Chat Completions request body: options, token limits, tools, and each
 * server family's reasoning parameters.
 */
import OpenAI from "openai";
import { resolveCacheRetention } from "../prompt-cache.ts";
import type {
  CacheRetention,
  ChatTemplateKwargValue,
  Message,
  Model,
  OpenAICompletionsCompat,
  StreamOptions,
  ThinkingBudgets,
  ThinkingTokenBudgetField,
  TranscriptContext,
} from "../types.ts";
import { getDeclaredTools, resolveTranscriptTools } from "../utils/transcript.ts";
import { createGrammarToolInputProperties } from "./constrained-sampling.ts";
import { clampOpenAIPromptCacheKey } from "./openai-prompt-cache.ts";
import { clampThinkingBudgetToAnswerRoom, thinkingBudgetForLevel } from "./simple-options.ts";
import {
  type ResolvedOpenAICompletionsCompat,
  resolveCompat,
  type CompletionsMessage,
  getCompatCacheControl,
  applyAnthropicCacheControl,
  convertMessages,
  convertTools,
} from "./openai-completions-convert.ts";

export interface OpenAICompletionsOptions extends StreamOptions {
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  /** Token budgets per thinking level. Used when `compat.thinkingTokenBudgetField` or `compat.supportsThinkingTokenBudget` is set, or by `{ "$var": "thinking.budget" }`. */
  thinkingBudgets?: ThinkingBudgets;
}

/**
 * Check if conversation messages contain tool calls or tool results.
 * This is needed because Anthropic (via proxy) requires the tools param
 * to be present when messages include tool_calls or tool role messages.
 */
function hasToolHistory(messages: Message[]): boolean {
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      return true;
    }

    if (msg.role === "assistant") {
      if (msg.content.some((block) => block.type === "toolCall")) {
        return true;
      }
    }
  }

  return false;
}

function getDeferredToolNames(messages: Message[]): Set<string> {
  const names = new Set<string>();

  for (const message of messages) {
    if (message.role === "toolResult") {
      for (const name of message.addedToolNames ?? []) {
        names.add(name);
      }
    }
  }

  return names;
}

type ResolvedChatTemplateKwargValue = string | number | boolean | null;

type CompletionsRequest = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  "messages"
> & {
  messages: CompletionsMessage[];
};

/**
 * The Chat Completions request body.
 *
 * - A transcript with tool history always sends `tools`, empty if need be: Anthropic behind
 *   LiteLLM-style proxies requires it whenever messages carry tool calls or results.
 * - OpenRouter normalizes reasoning across providers through a nested `reasoning` object.
 * - A top-level thinking budget field caps reasoning independently of `thinkingFormat`, since one
 *   server can serve zai, qwen or chat-template models. Reasoning and the answer share
 *   `max_tokens` there, so uncapped reasoning can consume the whole response.
 * - `samplingParams` merge last, so custom keys override the named request fields.
 */
export function buildParams(
  model: Model<"openai-completions">,
  context: TranscriptContext,
  options?: OpenAICompletionsOptions,
  compat: ResolvedOpenAICompletionsCompat = resolveCompat(model),
  cacheRetention: CacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env),
  grammarToolInputProperties: ReadonlyMap<string, string> = createGrammarToolInputProperties(
    getDeclaredTools(context.messages),
    compat.supportsOpenAIGrammarTools,
  ),
) {
  const transcriptTools = resolveTranscriptTools(
    context.messages,
    compat.supportsMidConvoSystemMessages === true && compat.supportsMidConvoToolAdditions === true,
  );

  const messages = convertMessages(model, context, compat, { grammarToolInputProperties });
  const cacheControl = getCompatCacheControl(compat, cacheRetention);

  const params: CompletionsRequest = {
    model: model.id,
    messages,
    stream: true,
    prompt_cache_key:
      (model.baseUrl.includes("api.openai.com") && cacheRetention !== "none") ||
      (cacheRetention === "long" && compat.supportsLongCacheRetention)
        ? clampOpenAIPromptCacheKey(options?.sessionId)
        : undefined,
    prompt_cache_retention:
      cacheRetention === "long" && compat.supportsLongCacheRetention ? "24h" : undefined,
  };

  if (compat.supportsUsageInStreaming !== false) {
    params.stream_options = { include_usage: true };
  }

  if (compat.supportsStore) {
    params.store = false;
  }

  if (options?.maxTokens) {
    if (compat.maxTokensField === "max_tokens") {
      params.max_tokens = options.maxTokens;
    } else {
      params.max_completion_tokens = options.maxTokens;
    }
  }

  if (options?.temperature !== undefined) {
    params.temperature = options.temperature;
  }

  const deferredToolNames =
    compat.deferredToolsMode === "kimi"
      ? getDeferredToolNames(context.messages)
      : new Set<string>();

  const activeTools = transcriptTools.requestTools.filter(
    (tool) => !deferredToolNames.has(tool.name),
  );

  if (activeTools.length > 0) {
    params.tools = convertTools(activeTools, compat);

    if (compat.zaiToolStream) {
      Object.assign(params, { tool_stream: true });
    }
  } else if (hasToolHistory(context.messages)) {
    params.tools = [];
  }

  if (cacheControl) {
    applyAnthropicCacheControl(messages, params.tools, cacheControl);
  }

  if (options?.toolChoice) {
    params.tool_choice = options.toolChoice;
  }

  const thinkingTokenBudgetField = resolveThinkingTokenBudgetField(compat);
  const thinkingBudget = resolveClampedThinkingBudget(model, options, params);

  if (compat.thinkingFormat === "zai" && model.reasoning) {
    Object.assign(params, {
      thinking: options?.reasoningEffort
        ? { type: "enabled", clear_thinking: false }
        : { type: "disabled" },
    });

    if (options?.reasoningEffort && compat.supportsReasoningEffort) {
      const mappedEffort = model.thinkingLevelMap?.[options.reasoningEffort];
      const effort = mappedEffort === undefined ? options.reasoningEffort : mappedEffort;

      if (effort !== null) Object.assign(params, { reasoning_effort: effort });
    }
  } else if (compat.thinkingFormat === "qwen" && model.reasoning) {
    Object.assign(params, { enable_thinking: !!options?.reasoningEffort });

    if (options?.reasoningEffort && compat.supportsReasoningEffort) {
      Object.assign(params, {
        reasoning_effort:
          model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort,
      });
    }
  } else if (compat.thinkingFormat === "qwen-chat-template" && model.reasoning) {
    Object.assign(params, {
      chat_template_kwargs: {
        enable_thinking: !!options?.reasoningEffort,
        preserve_thinking: true,
      },
    });
  } else if (compat.thinkingFormat === "chat-template" && model.reasoning) {
    const chatTemplateKwargs = buildChatTemplateValues(
      model,
      options,
      compat.chatTemplateKwargs,
      thinkingBudget,
    );

    if (chatTemplateKwargs) {
      Object.assign(params, { chat_template_kwargs: chatTemplateKwargs });
    }
  } else if (compat.thinkingFormat === "baseten" && model.reasoning) {
    const chatTemplateArgs = buildChatTemplateValues(
      model,
      options,
      compat.chatTemplateArgs,
      thinkingBudget,
    );

    if (chatTemplateArgs) {
      Object.assign(params, { chat_template_args: chatTemplateArgs });
    }

    if (compat.supportsReasoningEffort) {
      const requestedEffort = options?.reasoningEffort;

      const mappedEffort = requestedEffort
        ? model.thinkingLevelMap?.[requestedEffort]
        : model.thinkingLevelMap?.off;

      const effort = mappedEffort === undefined ? requestedEffort : mappedEffort;

      if (effort !== null && effort !== undefined) {
        Object.assign(params, { reasoning_effort: effort });
      }
    }
  } else if (compat.thinkingFormat === "deepseek" && model.reasoning) {
    if (options?.reasoningEffort) {
      Object.assign(params, { thinking: { type: "enabled" } });
    } else if (model.thinkingLevelMap?.off !== null) {
      Object.assign(params, { thinking: { type: "disabled" } });
    }

    if (options?.reasoningEffort && compat.supportsReasoningEffort) {
      Object.assign(params, {
        reasoning_effort:
          model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort,
      });
    }
  } else if (compat.thinkingFormat === "openrouter" && model.reasoning) {
    if (options?.reasoningEffort) {
      Object.assign(params, {
        reasoning: {
          effort: model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort,
        },
      });
    } else if (model.thinkingLevelMap?.off !== null) {
      Object.assign(params, { reasoning: { effort: model.thinkingLevelMap?.off ?? "none" } });
    }
  } else if (compat.thinkingFormat === "ant-ling" && model.reasoning && options?.reasoningEffort) {
    const effort = model.thinkingLevelMap?.[options.reasoningEffort];

    if (effort !== null && effort !== undefined) Object.assign(params, { reasoning: { effort } });
  } else if (compat.thinkingFormat === "together" && model.reasoning) {
    Object.assign(params, { reasoning: { enabled: !!options?.reasoningEffort } });

    if (options?.reasoningEffort && compat.supportsReasoningEffort) {
      Object.assign(params, {
        reasoning_effort:
          model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort,
      });
    }
  } else if (compat.thinkingFormat === "string-thinking" && model.reasoning) {
    if (options?.reasoningEffort) {
      Object.assign(params, {
        thinking: model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort,
      });
    } else if (model.thinkingLevelMap?.off !== null) {
      Object.assign(params, { thinking: model.thinkingLevelMap?.off ?? "none" });
    }
  } else if (options?.reasoningEffort && model.reasoning && compat.supportsReasoningEffort) {
    Object.assign(params, {
      reasoning_effort:
        model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort,
    });
  } else if (!options?.reasoningEffort && model.reasoning && compat.supportsReasoningEffort) {
    const offValue = model.thinkingLevelMap?.off;

    if (offValue !== null && offValue !== undefined) {
      Object.assign(params, { reasoning_effort: offValue });
    }
  }

  if (thinkingTokenBudgetField && thinkingBudget !== undefined) {
    Object.assign(params, { [thinkingTokenBudgetField]: thinkingBudget });
  }

  if (model.compat?.openRouterRouting) {
    Object.assign(params, { provider: model.compat.openRouterRouting });
  }

  if (model.compat?.vercelGatewayRouting) {
    const routing = model.compat.vercelGatewayRouting;

    if (routing.only || routing.order) {
      const gatewayOptions: Record<string, string[]> = {};

      if (routing.only) gatewayOptions.only = routing.only;

      if (routing.order) gatewayOptions.order = routing.order;
      Object.assign(params, { providerOptions: { gateway: gatewayOptions } });
    }
  }

  if (options?.samplingParams) {
    Object.assign(params, options.samplingParams);
  }

  return params;
}

function resolveThinkingTokenBudgetField(
  compat: Pick<OpenAICompletionsCompat, "thinkingTokenBudgetField" | "supportsThinkingTokenBudget">,
): ThinkingTokenBudgetField | undefined {
  if (compat.thinkingTokenBudgetField) return compat.thinkingTokenBudgetField;

  if (compat.supportsThinkingTokenBudget) return "thinking_token_budget";

  return undefined;
}

function resolveClampedThinkingBudget(
  model: Model<"openai-completions">,
  options: OpenAICompletionsOptions | undefined,
  params: { max_tokens?: number | null; max_completion_tokens?: number | null },
): number | undefined {
  if (!options?.reasoningEffort || !model.reasoning) return undefined;
  const ceiling = params.max_tokens ?? params.max_completion_tokens ?? model.maxTokens;

  const budget = clampThinkingBudgetToAnswerRoom(
    thinkingBudgetForLevel(options.reasoningEffort, options.thinkingBudgets),
    ceiling,
  );

  return budget > 0 ? budget : undefined;
}

function buildChatTemplateValues(
  model: Model<"openai-completions">,
  options: OpenAICompletionsOptions | undefined,
  values: Record<string, ChatTemplateKwargValue>,
  thinkingBudget?: number,
): Record<string, ResolvedChatTemplateKwargValue> | undefined {
  const resolvedValues: Record<string, ResolvedChatTemplateKwargValue> = {};

  for (const [key, value] of Object.entries(values)) {
    const resolved = resolveChatTemplateKwargValue(model, options, value, thinkingBudget);

    if (resolved !== undefined) {
      resolvedValues[key] = resolved;
    }
  }

  return Object.keys(resolvedValues).length > 0 ? resolvedValues : undefined;
}

function resolveChatTemplateKwargValue(
  model: Model<"openai-completions">,
  options: OpenAICompletionsOptions | undefined,
  value: ChatTemplateKwargValue,
  thinkingBudget?: number,
): ResolvedChatTemplateKwargValue | undefined {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const reasoningEffort = options?.reasoningEffort;

  if (!reasoningEffort && value.omitWhenOff) {
    return undefined;
  }

  if (value.$var === "thinking.enabled") {
    return !!reasoningEffort;
  }

  if (value.$var === "thinking.budget") {
    return thinkingBudget;
  }

  const mappedValue = reasoningEffort
    ? model.thinkingLevelMap?.[reasoningEffort]
    : model.thinkingLevelMap?.off;

  return mappedValue === undefined ? reasoningEffort : (mappedValue ?? undefined);
}
