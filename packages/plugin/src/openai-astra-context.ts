import type { ModelContextPolicy } from "@nyte-ai/core";
import type { Plugin } from "@nyte-ai/plugin/core";

/**
 * The context policy of `gpt-6-astra` on OpenAI and OpenAI Codex: a window
 * of one million tokens, compacted at 400 000.
 *
 * @category plugins
 * @since 0.1.0
 */
export const astra: readonly ModelContextPolicy[] = ["openai", "openai-codex"].map((provider) => ({
  model: { provider, id: "gpt-6-astra" },
  contextWindow: 1_000_000,
  compactAt: 400_000,
}));

/**
 * Gives the astra models their context window and compaction threshold,
 * folded into their `ModelInfo` and the sessions that run them.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "openai-astra-context",
  contribute: { modelContext: astra },
} satisfies Plugin;
