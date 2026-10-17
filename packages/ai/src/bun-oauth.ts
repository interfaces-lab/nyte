/**
 * Statically embeds OAuth flows in bundled Nyte hosts.
 */
import { anthropicOAuth } from "./auth/oauth/anthropic.ts";
import { registerOAuthFlow } from "./auth/oauth/load.ts";
import { openaiCodexOAuth } from "./auth/oauth/openai-codex.ts";

/** Register the OAuth flows included in this host bundle. */
export function registerBunOAuthFlows(): void {
  registerOAuthFlow("anthropic", anthropicOAuth);
  registerOAuthFlow("openaiCodex", openaiCodexOAuth);
}
