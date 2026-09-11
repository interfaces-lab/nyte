import { definePlugin } from "@nyte-ai/core/plugins";

export const OPENAI_ASTRA_CONTEXT_PLUGIN_ID = "openai/astra-context";

export function openaiAstraContextPlugin() {
  return definePlugin({
    id: OPENAI_ASTRA_CONTEXT_PLUGIN_ID,
    session(api) {
      api.modelContext.add((draft) => {
        for (const provider of ["openai", "openai-codex"]) {
          draft.set(`${provider}/gpt-6-astra`, {
            contextWindow: 1_000_000,
            compactAt: 400_000,
          });
        }
      });
    },
  });
}
