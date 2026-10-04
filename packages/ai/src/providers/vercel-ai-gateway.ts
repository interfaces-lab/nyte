/**
 * Vercel AI Gateway provider.
 *
 * Based on https://github.com/earendil-works/pi/blob/33e203354391ba26937cd1e8a210b4db10e82c66/packages/ai/src/providers/vercel-ai-gateway.ts
 * Synced with pi 33e203354.
 */
import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { verifyWithRequest } from "../auth/verify.ts";
import { createProvider, type Provider } from "../models.ts";

const VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

export function vercelAiGatewayProvider(): Provider<"anthropic-messages"> {
  const apiKey = envApiKeyAuth("Vercel AI Gateway API key", [
    "AI_GATEWAY_API_KEY",
    "VERCEL_OIDC_TOKEN",
  ]);

  return createProvider<"anthropic-messages">({
    id: "vercel-ai-gateway",
    name: "Vercel AI Gateway",
    baseUrl: VERCEL_AI_GATEWAY_BASE_URL,
    auth: {
      apiKey: {
        ...apiKey,
        // Nyte-only: OIDC tokens authenticate only as a bearer, which API keys also accept.
        resolve: async (input) => {
          const result = await apiKey.resolve(input);
          if (!result?.auth.apiKey) return result;
          const { apiKey: key, ...auth } = result.auth;

          return {
            ...result,
            auth: { ...auth, headers: { ...auth.headers, Authorization: `Bearer ${key}` } },
          };
        },
      },
      verify: ({ auth, signal }) =>
        verifyWithRequest({
          provider: "Vercel AI Gateway",
          url: `${auth.baseUrl ?? VERCEL_AI_GATEWAY_BASE_URL}/v1/credits`,
          headers: auth.headers ?? {},
          signal,
          detail: (body) =>
            typeof body === "object" &&
            body !== null &&
            "balance" in body &&
            typeof body.balance === "string"
              ? `balance ${body.balance}`
              : undefined,
        }),
    },
    api: { "anthropic-messages": anthropicMessagesApi() },
  });
}
