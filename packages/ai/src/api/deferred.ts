// One-shot provider calls. Each loads its client on first use so importing the
// package root does not bundle every SDK.
import { providerRequest } from "../model-variants.ts";
import type { AccountLimits, Context, Model } from "../types.ts";
import type { AnthropicOptions } from "./anthropic-messages.ts";
import type { OpenAICompactResult } from "./openai-compact.ts";
import type {
  OpenAICodexCompactResult,
  OpenAICodexResponsesOptions,
} from "./openai-codex-responses.ts";
import type { OpenAIResponsesOptions } from "./openai-responses.ts";

export async function fetchAnthropicAccountLimits(
  model: Model<"anthropic-messages">,
  options?: AnthropicOptions,
): Promise<AccountLimits> {
  const api = await import("./anthropic-messages.ts");

  return api.fetchAnthropicAccountLimits(model, options);
}

export async function fetchOpenAICodexAccountLimits(
  model: Model<"openai-codex-responses">,
  options?: OpenAICodexResponsesOptions,
): Promise<AccountLimits> {
  const api = await import("./openai-codex-responses.ts");

  return api.fetchOpenAICodexAccountLimits(model, options);
}

export async function compactOpenAICodexContext(
  selected: Model<"openai-codex-responses">,
  context: Context,
  selectedOptions?: OpenAICodexResponsesOptions,
): Promise<OpenAICodexCompactResult> {
  const api = await import("./openai-codex-responses.ts");
  const { model, options } = providerRequest(selected, selectedOptions);

  return api.compactOpenAICodexContext(model, context, options);
}

export async function compactOpenAIResponsesContext(
  selected: Model<"openai-responses">,
  context: Context,
  selectedOptions?: OpenAIResponsesOptions,
): Promise<OpenAICompactResult> {
  const api = await import("./openai-responses.ts");
  const { model, options } = providerRequest(selected, selectedOptions);

  return api.compactOpenAIResponsesContext(model, context, options);
}
