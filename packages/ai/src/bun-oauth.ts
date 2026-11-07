import { anthropicOAuth } from "./auth/oauth/anthropic.ts";
import { registerOAuthFlow } from "./auth/oauth/load.ts";
import { openaiCodexOAuth } from "./auth/oauth/openai-codex.ts";

export function registerBunOAuthFlows(): void {
  registerOAuthFlow("anthropic", anthropicOAuth);
  registerOAuthFlow("openaiCodex", openaiCodexOAuth);
}
