/**
 * The catalog every Nyte client composes: the same providers over the same
 * `~/.nyte` credential and model stores, so a login made in one client is a
 * login in all of them.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/model-resolver.ts
 */
import type { ProviderId } from "@nyte-ai/schema";
import { defaultProviderAuthContext } from "../auth/context.ts";
import { FileCredentialStore } from "../auth/store.ts";
import { FileModelsStore } from "../file-models-store.ts";
import { createModels, type MutableModels, type Provider } from "../models.ts";
import { anthropicProvider } from "./anthropic.ts";
import { githubCopilotProvider } from "./github-copilot.ts";
import { openaiCodexProvider } from "./openai-codex.ts";
import { openaiProvider } from "./openai.ts";
import { opencodeGoProvider } from "./opencode-go.ts";
import { opencodeProvider } from "./opencode.ts";

/** In the order a client falls back through them when nothing else decides. */
const NYTE_PROVIDERS: readonly (() => Provider)[] = [
  openaiCodexProvider,
  openaiProvider,
  anthropicProvider,
  opencodeProvider,
  opencodeGoProvider,
  githubCopilotProvider,
];

/**
 * Explicit defaults for providers whose first choice should not depend on feed order.
 * Providers without one use the first catalog entry.
 */
export const defaultModelPerProvider: Readonly<Record<ProviderId, string>> = {
  "openai-codex": "gpt-5.6-luna",
  openai: "gpt-5.6-luna",
  anthropic: "claude-opus-5",
};

export function createNyteModels(): MutableModels {
  const models = createModels({
    credentials: new FileCredentialStore(),
    authContext: defaultProviderAuthContext(),
    modelsStore: new FileModelsStore(),
    catalog: { url: process.env.NYTE_MODELS_URL },
  });

  for (const provider of NYTE_PROVIDERS) models.setProvider(provider());

  return models;
}
