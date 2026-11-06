import type { ModelContextPolicy } from "@nyte-ai/core";
import type { Plugin } from "@nyte-ai/plugin/core";

export const astra: readonly ModelContextPolicy[] = ["openai", "openai-codex"].map((provider) => ({
  model: { provider, id: "gpt-6-astra" },
  contextWindow: 1_000_000,
  compactAt: 400_000,
}));

export default {
  id: "openai-astra-context",
  contribute: { modelContext: astra },
} satisfies Plugin;
