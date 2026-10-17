/**
 * Lazy loaders for the built-in OAuth flows. Provider definitions advertise
 * OAuth through `lazyOAuth` + one of these, so the Node-only flow modules
 * (callback servers, PKCE) are imported only when a login or refresh runs.
 * Each flow module registers its flow when it loads, so a loader reads a typed
 * registry instead of an untyped module namespace.
 */
import type { OAuthAuth } from "../types.ts";

type OAuthFlowId = "anthropic" | "openaiCodex";

const registeredFlows = new Map<OAuthFlowId, OAuthAuth>();

/** Records a built-in flow; its module calls this on load, and bundled hosts call it up front. */
export function registerOAuthFlow(id: OAuthFlowId, flow: OAuthAuth): void {
  registeredFlows.set(id, flow);
}

/**
 * Loads an OAuth flow module through a variable specifier so bundlers cannot
 * follow the import into Node-only flow code (`node:http` callback servers,
 * `node:crypto` PKCE). Package exports keep resolution independent of chunk paths.
 * A bundled host has no source module to resolve, so a failure here means its
 * entry did not register the statically included flows.
 */
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
