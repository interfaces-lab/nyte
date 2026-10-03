import { createModels, hasApi } from "@nyte-ai/ai/models";
import { openaiCodexProvider } from "@nyte-ai/ai/providers/openai-codex";
import { ModelSchema } from "@nyte-ai/schema";
import { Value } from "typebox/value";
import type { NyteOptions } from "@nyte-ai/core";
import definition from "../model.json" with { type: "json" };

export function configureModels(env: Env) {
  const baseUrl = "http://127.0.0.1:8788/backend-api";
  const stored: unknown = definition;
  if (
    !Value.Check(ModelSchema, stored) ||
    stored.provider !== "openai-codex" ||
    !hasApi(stored, "openai-codex-responses")
  ) {
    throw new Error("Run pnpm sync:codex to configure the local Codex model");
  }
  const model = { ...stored, baseUrl };
  const models = createModels();
  models.setProvider({
    ...openaiCodexProvider(),
    baseUrl,
    getModels: () => [model],
    refreshModels: undefined,
    auth: {
      apiKey: {
        name: "Local Codex access token",
        resolve: async () => ({
          auth: { apiKey: env.OPENAI_CODEX_ACCESS_TOKEN },
          source: "Local Codex sign-in",
        }),
      },
    },
  });
  return {
    model,
    models,
    streamFn: (selected, context, options) =>
      models.streamSimple(selected, context, {
        ...options,
        transport: "sse",
        headers: { ...options?.headers, "x-nyte-token": env.NYTE_TOKEN },
      }),
  } satisfies Pick<NyteOptions, "models" | "model" | "streamFn">;
}
