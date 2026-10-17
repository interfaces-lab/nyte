import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import type { Provider } from "../models-types.ts";
import { createProvider } from "../provider.ts";
import { withOpenCodeSessionHeader } from "./opencode-headers.ts";
import { OPENCODE_PROMPT_CACHE } from "./opencode.ts";
import type { OpenCodeApi } from "./opencode.ts";

type OpenCodeGoApi = Exclude<OpenCodeApi, "google-generative-ai">;

export function opencodeGoProvider(): Provider<OpenCodeGoApi> {
  return createProvider({
    id: "opencode-go",
    name: "OpenCode Go",
    promptCache: OPENCODE_PROMPT_CACHE,
    auth: { apiKey: envApiKeyAuth("OpenCode API key", ["OPENCODE_API_KEY"]) },
    api: {
      "anthropic-messages": withOpenCodeSessionHeader(anthropicMessagesApi()),
      "openai-completions": withOpenCodeSessionHeader(openAICompletionsApi()),
      "openai-responses": withOpenCodeSessionHeader(openAIResponsesApi()),
    },
  });
}
