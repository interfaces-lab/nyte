/**
 * Lazy loaders for the built-in OAuth flows. Provider definitions advertise
 * OAuth through `lazyOAuth` + one of these, so the Node-only flow modules
 * (callback servers, PKCE) are imported only when a login or refresh runs.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/auth/oauth/load.ts
 * Synced with pi 7ebf9087e.
 */
import type { OAuthAuth } from "../types.ts";

/**
 * Loads an OAuth flow module through a variable specifier so bundlers cannot
 * follow the import into Node-only flow code (`node:http` callback servers,
 * `node:crypto` PKCE). The `.ts`/`.js` rewrite keeps the trick working from
 * both source and built output.
 */
// oxlint-disable-next-line anti-slop/no-unknown-returns -- pi-ported: a variable-specifier dynamic import has no static module shape; the loaders below narrow to their flow's export
const importOAuthModule = async (specifier: string): Promise<unknown> => {
  const runtimeSpecifier = import.meta.url.endsWith(".js")
    ? specifier.replace(/\.ts$/, ".js")
    : specifier;
  try {
    return await import(runtimeSpecifier);
  } catch (error) {
    // A bundled host has no source module to resolve, so reaching this import
    // means its entry did not register the statically included flows.
    throw new Error(
      `OAuth flow module ${specifier} is not loadable at runtime. Bundled hosts must register flows up front with registerBunOAuthFlows.`,
      { cause: error },
    );
  }
};

type OAuthFlowLoaders = {
  anthropic: () => OAuthAuth | Promise<OAuthAuth>;
  openaiCodex: () => OAuthAuth | Promise<OAuthAuth>;
};

let bundledLoaders: OAuthFlowLoaders | undefined;

/** Registers statically bundled OAuth flows. */
export function registerBundledOAuthFlowLoaders(loaders: OAuthFlowLoaders): void {
  bundledLoaders = loaders;
}

export const loadAnthropicOAuth = async (): Promise<OAuthAuth> => {
  if (bundledLoaders) return bundledLoaders.anthropic();
  return ((await importOAuthModule("./anthropic.ts")) as { anthropicOAuth: OAuthAuth })
    .anthropicOAuth;
};

export const loadOpenAICodexOAuth = async (): Promise<OAuthAuth> => {
  if (bundledLoaders) return bundledLoaders.openaiCodex();
  return ((await importOAuthModule("./openai-codex.ts")) as { openaiCodexOAuth: OAuthAuth })
    .openaiCodexOAuth;
};
