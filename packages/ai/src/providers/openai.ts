import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";

export function openaiProvider(): Provider<"openai-responses"> {
  return createProvider<"openai-responses">({
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    promptCache: {
      minimumRetentionMs: { short: 5 * 60_000, long: 24 * 60 * 60_000 },
    },
    auth: { apiKey: envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]) },
    api: { "openai-responses": openAIResponsesApi() },
  });
}
