import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { verifyWithRequest } from "../auth/verify.ts";
import { createProvider, type Provider } from "../models.ts";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export function openaiProvider(): Provider<"openai-responses"> {
  return createProvider<"openai-responses">({
    id: "openai",
    name: "OpenAI",
    baseUrl: OPENAI_BASE_URL,
    promptCache: {
      minimumRetentionMs: { short: 5 * 60_000, long: 24 * 60 * 60_000 },
    },
    auth: {
      apiKey: envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]),
      verify: ({ auth, signal }) =>
        verifyWithRequest({
          provider: "OpenAI",
          url: `${auth.baseUrl ?? OPENAI_BASE_URL}/models`,
          headers: { ...auth.headers, Authorization: `Bearer ${auth.apiKey ?? ""}` },
          signal,
        }),
    },
    api: { "openai-responses": openAIResponsesApi() },
  });
}
