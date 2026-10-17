/**
 * API-key discovery from environment variables, per provider. Reports which
 * variables are set (`findEnvKeys`) and resolves the key a request may use
 * (`getEnvApiKey`); ANTHROPIC_AUTH_TOKEN is reported but never returned as an
 * API key because requests must send it as a bearer token.
 */
import type { KnownProvider, ProviderEnv } from "./types.ts";
import { getProviderEnvValue } from "./utils/provider-env.ts";

export const ANTHROPIC_AUTH_TOKEN_ENV = "ANTHROPIC_AUTH_TOKEN";

export const ANTHROPIC_OAUTH_TOKEN_ENV = "ANTHROPIC_OAUTH_TOKEN";

export const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";

export const ANTHROPIC_FEDERATION_RULE_ID_ENV = "ANTHROPIC_FEDERATION_RULE_ID";

export const ANTHROPIC_ORGANIZATION_ID_ENV = "ANTHROPIC_ORGANIZATION_ID";

export const ANTHROPIC_SERVICE_ACCOUNT_ID_ENV = "ANTHROPIC_SERVICE_ACCOUNT_ID";

export const ANTHROPIC_IDENTITY_TOKEN_FILE_ENV = "ANTHROPIC_IDENTITY_TOKEN_FILE";

export const ANTHROPIC_WORKSPACE_ID_ENV = "ANTHROPIC_WORKSPACE_ID";

export const ANTHROPIC_ENV_KEYS = [
  ANTHROPIC_AUTH_TOKEN_ENV,
  ANTHROPIC_OAUTH_TOKEN_ENV,
  ANTHROPIC_API_KEY_ENV,
] as const;

/** ANTHROPIC_AUTH_TOKEN participates in env discovery and status, but getEnvApiKey() skips it because requests must pass it as Authorization: Bearer. */
function getApiKeyEnvVars(provider: string): readonly string[] | undefined {
  if (provider === "anthropic") {
    return ANTHROPIC_ENV_KEYS;
  }

  if (provider === "opencode" || provider === "opencode-go") return ["OPENCODE_API_KEY"];

  if (provider === "openai") return ["OPENAI_API_KEY"];

  return undefined;
}

/**
 * Find configured environment variables that can provide an API key for a provider.
 *
 * This only reports actual API key variables. It intentionally excludes ambient
 * credential sources such as AWS profiles, AWS IAM credentials, and Google
 * Application Default Credentials.
 */
export function findEnvKeys(provider: KnownProvider, env?: ProviderEnv): string[] | undefined;
export function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined;
export function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined {
  const envVars = getApiKeyEnvVars(provider);

  if (!envVars) return undefined;

  const found = envVars.filter((envVar) => !!getProviderEnvValue(envVar, env));

  return found.length > 0 ? found : undefined;
}

/**
 * Get API key for provider from known environment variables, e.g. OPENAI_API_KEY.
 *
 * Will not return API keys for providers that require OAuth tokens.
 */
export function getEnvApiKey(provider: KnownProvider, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined {
  const envKeys = findEnvKeys(provider, env);

  if (envKeys?.[0]) {
    const apiKeyEnv =
      provider === "anthropic"
        ? envKeys.find((key) => key !== ANTHROPIC_AUTH_TOKEN_ENV)
        : envKeys[0];

    if (apiKeyEnv) return getProviderEnvValue(apiKeyEnv, env);
  }

  return undefined;
}
