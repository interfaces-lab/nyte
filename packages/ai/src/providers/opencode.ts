import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { googleGenerativeAIApi } from "../api/google-generative-ai.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import type { Provider } from "../models-types.ts";
import { createProvider } from "../provider.ts";
import { withOpenCodeSessionHeader } from "./opencode-headers.ts";

export type OpenCodeApi =
  | "anthropic-messages"
  | "google-generative-ai"
  | "openai-completions"
  | "openai-responses";

export function opencodeProvider(): Provider<OpenCodeApi> {
  return createProvider({
    id: "opencode",
    name: "OpenCode Zen",
    // Models route to several upstream APIs
    // whose long-retention windows differ (1h on Anthropic, 24h on OpenAI) and
    // some catalog entries do not support long retention at all, so publish
    // only the floor every route guarantees.
    promptCache: {
      minimumRetentionMs: { short: 5 * 60_000, long: 5 * 60_000 },
    },
    auth: { apiKey: envApiKeyAuth("OpenCode API key", ["OPENCODE_API_KEY"]) },
    api: {
      "anthropic-messages": withOpenCodeSessionHeader(anthropicMessagesApi()),
      "google-generative-ai": withOpenCodeSessionHeader(googleGenerativeAIApi()),
      "openai-completions": withOpenCodeSessionHeader(openAICompletionsApi()),
      "openai-responses": withOpenCodeSessionHeader(openAIResponsesApi()),
    },
  });
}
