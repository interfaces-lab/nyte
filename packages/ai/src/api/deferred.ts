/**
 * One-shot provider calls. Each loads its client on first use so importing the
 * package root does not bundle every SDK.
 */
import { providerRequest } from "../model-variants.ts";
import type { Context, Model } from "../types.ts";
import type { OpenAICompactResult } from "./openai-compact.ts";
import type { OpenAICodexCompactResult } from "./openai-codex-compact.ts";
import type { OpenAICodexResponsesOptions } from "./openai-codex-protocol.ts";
import type { OpenAIResponsesOptions } from "./openai-responses.ts";

export async function compactOpenAICodexContext(
  selected: Model<"openai-codex-responses">,
  context: Context,
  selectedOptions?: OpenAICodexResponsesOptions,
): Promise<OpenAICodexCompactResult> {
  const api = await import("./openai-codex-compact.ts");
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
