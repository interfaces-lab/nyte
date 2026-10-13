import {
  compactOpenAICodexContext,
  compactOpenAIResponsesContext,
  providerIdentity,
} from "@nyte-ai/ai";
import type { Models, Usage as ProviderUsage } from "@nyte-ai/ai";
import type { Usage } from "@nyte-ai/schema";
import type { Plugin } from "./core.ts";

/**
 * Returns the plugin that compacts through OpenAI's own endpoint. On
 * `before_compaction`, when the session's model is OpenAI Responses (an API
 * key) or OpenAI Codex Responses (a ChatGPT account), it sends the messages
 * to summarise to the provider's compact endpoint and supplies the opaque
 * window it returns as the plan's `material`; core writes it without a
 * summary request. Any other model, or a provider without credentials,
 * leaves the plan to core. `models` is the host's, for credentials.
 *
 * @category plugins
 * @since 0.1.0
 */
export function openaiCompaction(models: Pick<Models, "getModel" | "getAuth">): Plugin {
  return {
    id: "openai-compaction",
    hooks: {
      before_compaction: async (plan, { signal }) => {
        const model = models.getModel(plan.model.provider, plan.model.id);
        const responses = model?.provider === "openai" && model.api === "openai-responses";
        const codex = model?.provider === "openai-codex" && model.api === "openai-codex-responses";

        if (plan.result !== null || model === undefined || (!responses && !codex)) return plan;
        const auth = await models.getAuth(model, { signal });

        if (auth === undefined) return plan;
        const base = { ...model, baseUrl: auth.auth.baseUrl ?? model.baseUrl };
        const options = { apiKey: auth.auth.apiKey, headers: auth.auth.headers, signal };

        const context = {
          messages: [
            ...plan.summarise,
            ...(plan.instructions === null
              ? []
              : [{ role: "system" as const, content: plan.instructions, timestamp: Date.now() }]),
          ],
        };

        const compacted = codex
          ? await compactOpenAICodexContext(
              { ...base, api: "openai-codex-responses" },
              context,
              options,
            )
          : await compactOpenAIResponsesContext(
              { ...base, api: "openai-responses" },
              context,
              options,
            );

        return {
          ...plan,
          result: {
            kind: "material",
            ...providerIdentity(model),
            data: compacted.data,
            usage: compacted.usage === undefined ? null : usageOf(compacted.usage),
          },
        };
      },
    },
  };
}

/** Returns a provider usage report as the session's `Usage`. */
function usageOf(usage: ProviderUsage): Usage {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    reasoning: usage.reasoning ?? null,
    total: usage.totalTokens,
    cost: usage.cost,
  };
}
