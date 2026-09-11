import {
  compactOpenAICodexContext,
  compactOpenAIResponsesContext,
  OpenAICodexCompactionError,
  type Models,
} from "@nyte-ai/ai";
import { definePlugin } from "@nyte-ai/core/plugins";

export const OPENAI_COMPACTION_PLUGIN_ID = "openai/compaction";
const COMPACTION_TIMEOUT_MS = 30_000;

export interface OpenAICompactionOptions {
  readonly models: Pick<Models, "getModel" | "getAuth">;
}

/** Native compaction for OpenAI API and ChatGPT accounts; the host owns fallback. */
export function openaiCompactionPlugin({ models }: OpenAICompactionOptions) {
  return definePlugin({
    id: OPENAI_COMPACTION_PLUGIN_ID,
    session(api) {
      api.hook("before_compaction", async (event, parentSignal) => {
        const model = models.getModel(event.model.provider, event.model.modelId);
        if (
          model === undefined ||
          !(
            (model.provider === "openai" && model.api === "openai-responses") ||
            (model.provider === "openai-codex" && model.api === "openai-codex-responses")
          )
        ) {
          return undefined;
        }
        // Codex owns a streaming idle timeout, not a total compaction deadline.
        const timeout =
          model.api === "openai-codex-responses"
            ? undefined
            : AbortSignal.timeout(COMPACTION_TIMEOUT_MS);
        const signal =
          timeout === undefined
            ? parentSignal
            : parentSignal === undefined
              ? timeout
              : AbortSignal.any([parentSignal, timeout]);
        signal?.throwIfAborted();
        const auth = await models.getAuth(model, { signal });
        signal?.throwIfAborted();
        if (auth === undefined) return undefined;
        const requestModel = { ...model, baseUrl: auth.auth.baseUrl ?? model.baseUrl };
        const context =
          event.customInstructions === undefined
            ? event.context
            : {
                ...event.context,
                systemPrompt: [event.context.systemPrompt, event.customInstructions]
                  .filter((part) => part !== undefined)
                  .join("\n\n"),
              };
        const options = { apiKey: auth.auth.apiKey, headers: auth.auth.headers, signal };
        try {
          const compacted =
            model.api === "openai-codex-responses"
              ? await compactOpenAICodexContext(
                  { ...requestModel, api: "openai-codex-responses" },
                  context,
                  options,
                )
              : await compactOpenAIResponsesContext(
                  { ...requestModel, api: "openai-responses" },
                  context,
                  options,
                );
          // Core checks cancellation before publishing and retains reported usage.
          return {
            material: {
              type: "provider",
              provider: model.provider,
              api: model.api,
              model: model.id,
              data: compacted.data,
            },
            usage: compacted.usage,
          };
        } catch (error) {
          if (!(error instanceof OpenAICodexCompactionError)) throw error;
          return { error: error.message, usage: error.usage };
        }
      });
    },
  });
}
