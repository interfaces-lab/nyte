import type { AnthropicOptions } from "./api/anthropic-messages.ts";
import type { GoogleOptions } from "./api/google-generative-ai.ts";
import type { OpenAICodexResponsesOptions } from "./api/openai-codex-protocol.ts";
import type { OpenAICompletionsOptions } from "./api/openai-completions-params.ts";
import type { OpenAIResponsesOptions } from "./api/openai-responses.ts";
import type { Api, StreamOptions } from "./types.ts";

export interface ApiOptionsMap {
  "anthropic-messages": AnthropicOptions;
  "google-generative-ai": GoogleOptions;
  "openai-completions": OpenAICompletionsOptions;
  "openai-responses": OpenAIResponsesOptions;
  "openai-codex-responses": OpenAICodexResponsesOptions;
}

export type ApiStreamOptions<TApi extends Api> = StreamOptions &
  (TApi extends keyof ApiOptionsMap ? ApiOptionsMap[TApi] : Record<string, unknown>);
