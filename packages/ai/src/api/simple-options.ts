import { clampThinkingLevel } from "../model-capabilities.ts";
import type {
  Api,
  Model,
  ModelThinkingLevel,
  SimpleStreamOptions,
  StreamOptions,
  ThinkingBudgets,
  ThinkingLevel,
  TranscriptContext,
} from "../types.ts";
import { estimateContextTokens } from "../utils/estimate.ts";

const CONTEXT_SAFETY_TOKENS = 4096;

const MIN_MAX_TOKENS = 1;

export function clampMaxTokensToContext(
  model: Model<Api>,
  context: TranscriptContext,
  maxTokens: number,
): number {
  if (model.contextWindow <= 0) return Math.max(MIN_MAX_TOKENS, maxTokens);

  const available =
    model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;

  return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, available));
}

export function buildBaseOptions(
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): StreamOptions & Pick<SimpleStreamOptions, "toolChoice"> {
  const samplingParams =
    model.samplingParams || options?.samplingParams
      ? { ...model.samplingParams, ...options?.samplingParams }
      : undefined;

  return {
    temperature: options?.temperature,
    samplingParams,
    maxTokens: clampMaxTokensToContext(model, context, options?.maxTokens ?? model.maxTokens),
    signal: options?.signal,
    fast: options?.fast,
    apiKey: options?.apiKey,
    fetch: options?.fetch,
    transport: options?.transport,
    cacheRetention: options?.cacheRetention,
    sessionId: options?.sessionId,
    headers: options?.headers,
    onPayload: options?.onPayload,
    onResponse: options?.onResponse,
    onAccountLimits: options?.onAccountLimits,
    timeoutMs: options?.timeoutMs,
    websocketConnectTimeoutMs: options?.websocketConnectTimeoutMs,
    maxRetries: options?.maxRetries,
    maxRetryDelayMs: options?.maxRetryDelayMs,
    metadata: options?.metadata,
    env: options?.env,
    toolChoice: options?.toolChoice,
  };
}

export function simpleReasoningEffort(
  model: Model<Api>,
  reasoning: ThinkingLevel | undefined,
): Exclude<ModelThinkingLevel, "off"> | undefined {
  const clamped = reasoning ? clampThinkingLevel(model, reasoning) : undefined;

  return clamped === "off" ? undefined : clamped;
}

const MIN_ANSWER_TOKENS = 1024;

const DEFAULT_THINKING_BUDGETS: ThinkingBudgets = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
};

function clampReasoning(
  effort: ThinkingLevel | undefined,
): Exclude<ThinkingLevel, "xhigh" | "max"> | undefined {
  return effort === "xhigh" || effort === "max" ? "high" : effort;
}

export function thinkingBudgetForLevel(
  reasoningLevel: ThinkingLevel,
  customBudgets?: ThinkingBudgets,
): number {
  const budgets = { ...DEFAULT_THINKING_BUDGETS, ...customBudgets };
  const level = clampReasoning(reasoningLevel)!;

  return budgets[level]!;
}

export function clampThinkingBudgetToAnswerRoom(thinkingBudget: number, ceiling: number): number {
  return Math.min(thinkingBudget, Math.max(0, ceiling - MIN_ANSWER_TOKENS));
}

export function adjustMaxTokensForThinking(
  baseMaxTokens: number | undefined,
  modelMaxTokens: number,
  reasoningLevel: ThinkingLevel,
  customBudgets?: ThinkingBudgets,
) {
  let thinkingBudget = thinkingBudgetForLevel(reasoningLevel, customBudgets);

  const maxTokens =
    baseMaxTokens === undefined
      ? modelMaxTokens
      : Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);

  if (maxTokens <= thinkingBudget) {
    thinkingBudget = clampThinkingBudgetToAnswerRoom(thinkingBudget, maxTokens);
  }

  return { maxTokens, thinkingBudget };
}
