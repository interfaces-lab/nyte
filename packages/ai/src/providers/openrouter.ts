/**
 * OpenRouter provider.
 */
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { verifyWithRequest } from "../auth/verify.ts";
import type { Provider } from "../models-types.ts";
import { createProvider } from "../provider.ts";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function openrouterProvider(): Provider<"openai-completions"> {
  return createProvider<"openai-completions">({
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: OPENROUTER_BASE_URL,
    auth: {
      apiKey: envApiKeyAuth("OpenRouter API key", ["OPENROUTER_API_KEY"]),
      verify: ({ auth, signal }) =>
        verifyWithRequest({
          provider: "OpenRouter",
          url: `${auth.baseUrl ?? OPENROUTER_BASE_URL}/key`,
          headers: { ...auth.headers, Authorization: `Bearer ${auth.apiKey ?? ""}` },
          signal,
          detail: (body) => {
            if (typeof body !== "object" || body === null || !("data" in body)) return undefined;
            const key = body.data;
            if (typeof key !== "object" || key === null) return undefined;
            if (!("limit" in key) || typeof key.limit !== "number") return "no credit limit";
            const remaining =
              "limit_remaining" in key && typeof key.limit_remaining === "number"
                ? `, ${String(key.limit_remaining)} remaining`
                : "";

            return `credit limit ${String(key.limit)}${remaining}`;
          },
        }),
    },
    api: { "openai-completions": openAICompletionsApi() },
  });
}
