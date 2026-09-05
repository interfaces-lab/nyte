/**
 * Statically embeds OAuth flows in bundled Nyte hosts.
 *
 * Based on https://github.com/earendil-works/pi/blob/92d8e2d17d4f357788381c49ce2cdb3f4ed1f21c/packages/ai/src/bun-oauth.ts
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
