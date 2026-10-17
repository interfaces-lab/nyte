/**
 * Building blocks for provider auth definitions: the standard env-var api-key
 * auth with a paste-your-key login, and a lazy OAuth wrapper that defers
 * loading Node-only flow code until first use.
 */
import type { ApiKeyAuth, OAuthAuth } from "./types.ts";

/**
 * Standard api-key auth: a stored credential key wins, otherwise the first
 * set env var resolves. Includes a `login` that prompts for the key.
 * Providers with non-standard resolution (provider env, ambient files, IAM)
 * write their own `ApiKeyAuth`.
 */
export function envApiKeyAuth(name: string, envVars: readonly string[]): ApiKeyAuth {
  return {
    name,
    login: async (interaction) => {
      interaction.signal.throwIfAborted();
      const key = await interaction.prompt({ type: "secret", message: `Enter ${name}` });
      interaction.signal.throwIfAborted();

      return { type: "api_key", key };
    },
    resolve: async ({ ctx, credential, signal }) => {
      signal.throwIfAborted();

      if (credential?.key) {
        return {
          auth: { apiKey: credential.key },
          env: credential.env,
          source: "stored credential",
        };
      }

      for (const envVar of envVars) {
        const value = await ctx.env(envVar);
        signal.throwIfAborted();

        if (value) return { auth: { apiKey: value }, source: envVar };
      }

      return undefined;
    },
  };
}

/**
 * Loads an OAuth flow on first login, refresh, or auth conversion.
 * Only a successful load is kept: a cached rejection would poison every later
 * login, refresh, and toAuth call for the life of the process.
 */
export function lazyOAuth(input: {
  name: string;
  isSubscription?: boolean;
  loginLabel?: string;
  load: () => Promise<OAuthAuth>;
}): OAuthAuth {
  let promise: Promise<OAuthAuth> | undefined;

  const loaded = () => {
    promise ??= input.load().catch((error) => {
      promise = undefined;
      throw error;
    });

    return promise;
  };

  return {
    name: input.name,
    isSubscription: input.isSubscription,
    loginLabel: input.loginLabel,
    login: async (interaction) => (await loaded()).login(interaction),
    refresh: async (credential, signal) => (await loaded()).refresh(credential, signal),
    toAuth: async (credential) => (await loaded()).toAuth(credential),
  };
}
