import { openAICodexResponsesApi } from "../api/openai-codex-responses.lazy.ts";
import { fetchOpenAICodexAccountLimits } from "./openai-codex-limits.ts";
import { lazyOAuth } from "../auth/helpers.ts";
import { loadOpenAICodexOAuth } from "../auth/oauth/load.ts";
import type { Provider } from "../models-types.ts";
import { createProvider } from "../provider.ts";

export function openaiCodexProvider(): Provider<"openai-codex-responses"> {
  return createProvider<"openai-codex-responses">({
    id: "openai-codex",
    name: "OpenAI Codex",
    baseUrl: "https://chatgpt.com/backend-api",
    promptCache: {
      minimumRetentionMs: { short: 5 * 60_000, long: 5 * 60_000 },
    },
    auth: {
      oauth: lazyOAuth({
        name: "OpenAI (ChatGPT Plus/Pro)",
        isSubscription: true,
        load: loadOpenAICodexOAuth,
      }),
    },
    fetchAccountLimits: ({ auth, signal }) =>
      fetchOpenAICodexAccountLimits(
        {
          provider: "openai-codex",
          baseUrl: auth.baseUrl ?? "https://chatgpt.com/backend-api",
        },
        { apiKey: auth.apiKey, headers: auth.headers, signal },
      ),
    api: { "openai-codex-responses": openAICodexResponsesApi() },
  });
}
