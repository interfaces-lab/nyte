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

/** The request options every API's `streamSimple` forwards unchanged to its `stream`. */
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

/** The simple reasoning level clamped to what `model` supports, or undefined for no reasoning. */
export function simpleReasoningEffort(
  model: Model<Api>,
  reasoning: ThinkingLevel | undefined,
): Exclude<ModelThinkingLevel, "off"> | undefined {
  const clamped = reasoning ? clampThinkingLevel(model, reasoning) : undefined;

  return clamped === "off" ? undefined : clamped;
}

/** Tokens always left for the answer when a thinking budget shares the response ceiling. */
export const MIN_ANSWER_TOKENS = 1024;

export const DEFAULT_THINKING_BUDGETS: ThinkingBudgets = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
};

export function clampReasoning(
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

/** Cap a thinking budget so at least MIN_ANSWER_TOKENS remain under a shared response ceiling. */
export function clampThinkingBudgetToAnswerRoom(thinkingBudget: number, ceiling: number): number {
  return Math.min(thinkingBudget, Math.max(0, ceiling - MIN_ANSWER_TOKENS));
}

/**
 * The output cap and thinking budget for a budget-based thinking request. An undefined
 * `baseMaxTokens` means the caller set no cap: the model cap is used and thinking fits inside it.
 */
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
