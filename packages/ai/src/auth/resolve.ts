/**
 * Provider auth resolution: explicit overrides first, then the stored
 * credential (OAuth refreshed under the store lock with double-checked
 * expiry), then ambient sources. Storage and refresh failures surface as
 * `ModelsError` with a code the caller can branch on.
 */
import type { ProviderEnv } from "../types.ts";
import { operationSignal, raceWithAbortSignal } from "../utils/abort.ts";
import { formatThrownValue } from "../utils/diagnostics.ts";
import type {
  ApiKeyAuth,
  ApiKeyCredential,
  AuthContext,
  AuthResult,
  CredentialAccounts,
  CredentialStore,
  OAuthAuth,
  OAuthCredential,
  ProviderAuth,
} from "./types.ts";

export type ModelsErrorCode =
  | "model_source"
  | "model_validation"
  | "provider"
  | "stream"
  | "auth"
  | "oauth";

export interface AuthResolutionOverrides {
  apiKey?: string;
  env?: ProviderEnv;
  /** Require this much remaining OAuth-token validity; defaults to five minutes. */
  minOAuthValidityMs?: number;
  signal?: AbortSignal;
}

export class ModelsError extends Error {
  readonly code: ModelsErrorCode;

  constructor(code: ModelsErrorCode, message: string, options?: { cause?: unknown }) {
    super(withCauseDetail(message, options?.cause), options);
    this.name = "ModelsError";
    this.code = code;
  }
}

/** Callers surface `error.message` only, so keep the underlying reason in it. */
function withCauseDetail(message: string, cause: unknown): string {
  if (cause === undefined || cause === null) return message;
  const detail = formatThrownValue(cause).trim();

  if (!detail || message.includes(detail)) return message;

  return `${message}: ${detail}`;
}

/**
 * Auth resolution shared by the `Models` and `ImagesModels` collections.
 * A stored credential owns the provider: ambient/env is consulted only when
 * nothing is stored. No silent env fallback after a failed refresh or for a
 * credential type without a matching handler.
 */
export function resolveProviderAuth(
  provider: { id: string; auth: ProviderAuth },
  credentials: CredentialStore,
  authContext: AuthContext,
  overrides?: AuthResolutionOverrides,
): Promise<AuthResult | undefined> {
  const signal = operationSignal(overrides?.signal);

  return raceWithAbortSignal(
    resolveProviderAuthWithSignal(provider, credentials, authContext, overrides, signal),
    signal,
  );
}

/** Resolves auth from overrides, then stored accounts, then ambient sources (env vars, AWS profiles, ADC files). */
async function resolveProviderAuthWithSignal(
  provider: { id: string; auth: ProviderAuth },
  credentials: CredentialStore,
  authContext: AuthContext,
  overrides: AuthResolutionOverrides | undefined,
  signal: AbortSignal,
): Promise<AuthResult | undefined> {
  signal.throwIfAborted();

  const requestAuthContext = overrides?.env
    ? overlayEnvAuthContext(authContext, overrides.env)
    : authContext;

  if (overrides?.apiKey !== undefined && provider.auth.apiKey) {
    return resolveApiKey(
      requestAuthContext,
      provider.auth.apiKey,
      provider.id,
      {
        type: "api_key",
        key: overrides.apiKey,
        env: overrides.env,
      },
      signal,
    );
  }

  const stored = await readCredential(credentials, provider.id, signal);
  const account = stored?.accounts.find((entry) => entry.id === stored.active);

  if (stored) {
    if (!account) return undefined;
    const credential = account.credential;

    if (credential.type === "oauth" && provider.auth.oauth) {
      return resolveStoredOAuth(
        credentials,
        provider.id,
        account.id,
        provider.auth.oauth,
        credential,
        signal,
        overrides?.minOAuthValidityMs,
      );
    }

    if (credential.type === "api_key" && provider.auth.apiKey) {
      const effective = overrides?.env
        ? { ...credential, env: { ...credential.env, ...overrides.env } }
        : credential;

      const result = await resolveApiKey(
        requestAuthContext,
        provider.auth.apiKey,
        provider.id,
        effective,
        signal,
      );

      return result ? { ...result, accountId: account.id } : undefined;
    }

    return undefined;
  }

  return provider.auth.apiKey
    ? resolveApiKey(requestAuthContext, provider.auth.apiKey, provider.id, undefined, signal)
    : undefined;
}

function overlayEnvAuthContext(base: AuthContext, env: ProviderEnv): AuthContext {
  return {
    env: async (name) => env[name] || (await base.env(name)),
    fileExists: (path) => base.fileExists(path),
  };
}

const DEFAULT_OAUTH_MINIMUM_VALIDITY_MS = 5 * 60 * 1000;

/**
 * Cap on one token refresh. Every refresh runs inside `CredentialStore.modify`,
 * so this is also how long a refresh can hold the credential lock other clients
 * are waiting on.
 */
export const DEFAULT_OAUTH_REFRESH_TIMEOUT_MS = 15_000;

/**
 * OAuth resolution with double-checked locking: tokens with less than five
 * minutes remaining lock, re-check expiry under the lock, refresh once
 * globally, and persist the rotated credential before release. The normal
 * five-minute window triggers a refresh but does not impose a provider contract;
 * an explicit `minOAuthValidityMs` (such as bearer-token export) must still hold
 * after the refresh.
 */
async function resolveStoredOAuth(
  credentials: CredentialStore,
  providerId: string,
  accountId: string,
  oauth: OAuthAuth,
  stored: OAuthCredential,
  signal: AbortSignal,
  minOAuthValidityMs?: number,
): Promise<AuthResult | undefined> {
  const minimumValidityMs = Math.max(DEFAULT_OAUTH_MINIMUM_VALIDITY_MS, minOAuthValidityMs ?? 0);

  const expiresSoon = (credential: OAuthCredential) =>
    Date.now() + minimumValidityMs >= credential.expires;

  let credential = stored;
  let refreshed: { readonly token: string; readonly credential: OAuthCredential } | undefined;

  if (expiresSoon(credential)) {
    let post: CredentialAccounts | undefined;

    try {
      post = await credentials.modify(
        providerId,
        async (current) => {
          const account = current?.accounts.find((entry) => entry.id === accountId);

          if (!current || account?.credential.type !== "oauth") return undefined;
          const previous = account.credential;

          if (!expiresSoon(previous)) return undefined;

          try {
            if (refreshed?.token !== previous.refresh) {
              const next = await oauth.refresh(
                previous,
                AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_OAUTH_REFRESH_TIMEOUT_MS)]),
              );
              refreshed = { token: previous.refresh, credential: next };
            }

            const next = refreshed.credential;

            return {
              ...current,
              accounts: current.accounts.map((entry) =>
                entry.id === accountId ? { ...entry, credential: next } : entry,
              ),
            };
          } catch (error) {
            throw new ModelsError("oauth", `OAuth refresh failed for ${providerId}`, {
              cause: error,
            });
          }
        },
        { signal },
      );
    } catch (error) {
      if (error instanceof ModelsError) throw error;
      throw new ModelsError("auth", `Credential store modify failed for ${providerId}`, {
        cause: error,
      });
    }

    const account = post?.accounts.find((entry) => entry.id === accountId);

    if (account?.credential.type !== "oauth") return undefined;
    credential = account.credential;

    if (minOAuthValidityMs !== undefined && expiresSoon(credential)) {
      throw new ModelsError(
        "oauth",
        `OAuth refresh returned a token that expires too soon for ${providerId}`,
      );
    }
  }

  try {
    return { auth: await oauth.toAuth(credential), source: "OAuth", accountId };
  } catch (error) {
    throw new ModelsError("oauth", `OAuth auth derivation failed for ${providerId}`, {
      cause: error,
    });
  }
}

async function resolveApiKey(
  authContext: AuthContext,
  apiKey: ApiKeyAuth,
  providerId: string,
  credential: ApiKeyCredential | undefined,
  signal: AbortSignal,
): Promise<AuthResult | undefined> {
  try {
    return await apiKey.resolve({ ctx: authContext, credential, signal });
  } catch (error) {
    throw new ModelsError("auth", `API key auth failed for provider ${providerId}`, {
      cause: error,
    });
  }
}

async function readCredential(
  credentials: CredentialStore,
  providerId: string,
  signal: AbortSignal,
): Promise<CredentialAccounts | undefined> {
  try {
    return await credentials.read(providerId, { signal });
  } catch (error) {
    throw new ModelsError("auth", `Credential store read failed for ${providerId}`, {
      cause: error,
    });
  }
}
