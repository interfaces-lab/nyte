/**
 * The per-API stream option map. It imports each API module's option type, so it
 * lives apart from `types.ts`, which those modules import for the base contract.
 */
import type { AnthropicOptions } from "./api/anthropic-messages.ts";
import type { GoogleOptions } from "./api/google-generative-ai.ts";
import type { OpenAICodexResponsesOptions } from "./api/openai-codex-protocol.ts";
import type { OpenAICompletionsOptions } from "./api/openai-completions-params.ts";
import type { OpenAIResponsesOptions } from "./api/openai-responses.ts";
import type { Api, StreamOptions } from "./types.ts";

/**
 * Maps known APIs to their full provider-specific stream option types.
 * Type-only imports from API implementation modules are erased at emit, so
 * this is tree-shake safe.
 */
export interface ApiOptionsMap {
  "anthropic-messages": AnthropicOptions;
  "google-generative-ai": GoogleOptions;
  "openai-completions": OpenAICompletionsOptions;
  "openai-responses": OpenAIResponsesOptions;
  "openai-codex-responses": OpenAICodexResponsesOptions;
}

/**
 * Full stream options for an API. Known APIs resolve to their concrete option
 * type; custom API strings fall back to the generic shape.
 */
export type ApiStreamOptions<TApi extends Api> = StreamOptions &
  (TApi extends keyof ApiOptionsMap ? ApiOptionsMap[TApi] : Record<string, unknown>);
