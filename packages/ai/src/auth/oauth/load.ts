import type { OAuthAuth } from "../types.ts";

type OAuthFlowId = "anthropic" | "openaiCodex";

const registeredFlows = new Map<OAuthFlowId, OAuthAuth>();

export function registerOAuthFlow(id: OAuthFlowId, flow: OAuthAuth): void {
  registeredFlows.set(id, flow);
}

async function importOAuthModule(specifier: string): Promise<void> {
  try {
    await import(specifier);
  } catch (error) {
    throw new Error(
      `OAuth flow module ${specifier} is not loadable at runtime. Bundled hosts must register flows up front with registerBunOAuthFlows.`,
      { cause: error },
    );
  }
}

async function loadOAuthFlow(id: OAuthFlowId, specifier: string): Promise<OAuthAuth> {
  if (!registeredFlows.has(id)) await importOAuthModule(specifier);
  const flow = registeredFlows.get(id);

  if (flow === undefined)
    throw new Error(`OAuth flow module ${specifier} did not register its flow`);

  return flow;
}

export const loadAnthropicOAuth = (): Promise<OAuthAuth> =>
  loadOAuthFlow("anthropic", "@nyte-ai/ai/auth/oauth/anthropic");

export const loadOpenAICodexOAuth = (): Promise<OAuthAuth> =>
  loadOAuthFlow("openaiCodex", "@nyte-ai/ai/auth/oauth/openai-codex");
