/**
 * Statically embeds OAuth flows in bundled Nyte hosts.
 */
import { anthropicOAuth } from "./auth/oauth/anthropic.ts";
import { registerBundledOAuthFlowLoaders } from "./auth/oauth/load.ts";
import { openaiCodexOAuth } from "./auth/oauth/openai-codex.ts";

/** Register the OAuth flows included in this host bundle. */
export function registerBunOAuthFlows(): void {
  registerBundledOAuthFlowLoaders({
    anthropic: () => anthropicOAuth,
    openaiCodex: () => openaiCodexOAuth,
  });
}
