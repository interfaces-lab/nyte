/**
 * OpenAI Codex (ChatGPT OAuth) flow: browser login races a localhost callback
 * server on port 1455 against a manual paste prompt; device-code login covers
 * headless boxes via the shared RFC 8628 poller. Node-only (node:crypto,
 * node:http) and loaded lazily so browser builds never pull those in.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/auth/oauth/openai-codex.ts
 * Synced with pi 7ebf9087e.
 */

import { Type } from "typebox";
import { Value } from "typebox/value";
import { getProviderEnvValue } from "../../utils/provider-env.ts";
import {
  OAuthTokenResponseSchema,
  type OAuthAuth,
  type OAuthCredential,
  type ProviderAuthInteraction,
} from "../types.ts";
import { pollOAuthDeviceCodeFlow } from "./device-code.ts";
import { oauthErrorHtml, oauthSuccessHtml } from "./oauth-page.ts";
import { generatePKCE } from "./pkce.ts";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

const AUTH_BASE_URL = "https://auth.openai.com";

const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`;

const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;

const REDIRECT_URI = "http://localhost:1455/auth/callback";

const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;

const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;

const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;

const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;

const DEVICE_CODE_TIMEOUT_SECONDS = 15 * 60;

const OPENAI_CODEX_BROWSER_LOGIN_METHOD = "browser";

const OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD = "device_code";

const SCOPE = "openid profile email offline_access";

const JWT_CLAIM_PATH = "https://api.openai.com/auth";

// Nyte divergence: exported for Nyte's legacy api/responses.ts, which stamps
// the same originator on Codex requests; pi inlines "pi" at the call sites.
export const ORIGINATOR = "nyte";

type OAuthToken = { access: string; refresh: string; expires: number };

type TokenOperation = "exchange" | "refresh";

function getCallbackHost(): string {
  return getProviderEnvValue("NYTE_OAUTH_CALLBACK_HOST") || "127.0.0.1";
}

const DeviceCodeResponse = Type.Object({
  device_auth_id: Type.String({ minLength: 1 }),
  user_code: Type.String({ minLength: 1 }),
  interval: Type.Union([Type.Number(), Type.String()]),
});

const DeviceTokenResponse = Type.Object({
  authorization_code: Type.String({ minLength: 1 }),
  code_verifier: Type.String({ minLength: 1 }),
});

const DeviceErrorCode = Type.Object({ error: Type.String() });

const NestedDeviceErrorCode = Type.Object({ error: Type.Object({ code: Type.String() }) });

const JwtClaims = Type.Object({
  [JWT_CLAIM_PATH]: Type.Optional(
    Type.Object({ chatgpt_account_id: Type.Optional(Type.String()) }),
  ),
});

type DeviceAuthInfo = {
  deviceAuthId: string;
  userCode: string;
  intervalSeconds: number;
};

type DeviceTokenSuccess = {
  authorizationCode: string;
  codeVerifier: string;
};

/** Node builtins load through `process.getBuiltinModule` so browser builds never resolve them. */
function assertNodeRuntime(): void {
  if (typeof process === "undefined" || !(process.versions?.node || process.versions?.bun)) {
    throw new Error("OpenAI Codex OAuth is only available in Node.js environments");
  }
}

function createState(): string {
  assertNodeRuntime();

  return process.getBuiltinModule("node:crypto").randomBytes(16).toString("hex");
}

function parseAuthorizationInput(input: string) {
  const value = input.trim();

  if (!value) return {};

  try {
    const url = new URL(value);

    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    // not a URL
  }

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);

    return { code, state };
  }

  if (value.includes("code=")) {
    const params = new URLSearchParams(value);

    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }

  return { code: value };
}

function decodeJwt(token: string) {
  try {
    const parts = token.split(".");

    if (parts.length !== 3) return null;
    const payload = parts[1] ?? "";
    const claims: unknown = JSON.parse(atob(payload));

    return Value.Check(JwtClaims, claims) ? claims : null;
  } catch {
    return null;
  }
}

async function fetchWithLoginCancellation(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (init.signal?.aborted) {
      throw new Error("Login cancelled");
    }

    throw error;
  }
}

async function readTokenResponse(
  response: Response,
  operation: TokenOperation,
): Promise<OAuthToken> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `OpenAI Codex token ${operation} failed (${response.status}): ${text || response.statusText}`,
    );
  }

  const json: unknown = await response.json();

  if (!Value.Check(OAuthTokenResponseSchema, json)) {
    throw new Error(
      `OpenAI Codex token ${operation} response missing fields: ${JSON.stringify(json)}`,
    );
  }

  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  redirectUri: string,
  signal: AbortSignal,
): Promise<OAuthToken> {
  const response = await fetchWithLoginCancellation(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
    signal,
  });

  return readTokenResponse(response, "exchange");
}

async function refreshAccessToken(refreshToken: string, signal: AbortSignal): Promise<OAuthToken> {
  let response: Response;

  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
      signal,
    });
  } catch (error) {
    throw new Error(
      `OpenAI Codex token refresh error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return readTokenResponse(response, "refresh");
}

async function startOpenAICodexDeviceAuth(signal: AbortSignal): Promise<DeviceAuthInfo> {
  const response = await fetchWithLoginCancellation(DEVICE_USER_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
    signal,
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        "OpenAI Codex device code login is not enabled for this server. Use browser login or verify the server URL.",
      );
    }

    const responseBody = await response.text().catch(() => "");
    throw new Error(
      `OpenAI Codex device code request failed with status ${response.status}${responseBody ? `: ${responseBody}` : ""}`,
    );
  }

  const json: unknown = await response.json();

  const invalid = new Error(`Invalid OpenAI Codex device code response: ${JSON.stringify(json)}`);

  if (!Value.Check(DeviceCodeResponse, json)) throw invalid;
  // Number() trims surrounding whitespace, so numeric strings and numbers convert alike.
  const intervalSeconds = Number(json.interval);

  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) throw invalid;

  return {
    deviceAuthId: json.device_auth_id,
    userCode: json.user_code,
    intervalSeconds,
  };
}

async function pollOpenAICodexDeviceAuth(
  device: DeviceAuthInfo,
  signal: AbortSignal,
): Promise<DeviceTokenSuccess> {
  return pollOAuthDeviceCodeFlow<DeviceTokenSuccess>({
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS,
    signal,
    poll: async () => {
      const response = await fetchWithLoginCancellation(DEVICE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_auth_id: device.deviceAuthId,
          user_code: device.userCode,
        }),
        signal,
      });

      if (response.ok) {
        const json: unknown = await response.json();

        if (!Value.Check(DeviceTokenResponse, json)) {
          return {
            status: "failed",
            message: `Invalid OpenAI Codex device auth token response: ${JSON.stringify(json)}`,
          };
        }

        return {
          status: "complete",
          value: { authorizationCode: json.authorization_code, codeVerifier: json.code_verifier },
        };
      }

      if (response.status === 403 || response.status === 404) {
        return { status: "pending" };
      }

      const responseBody = await response.text().catch(() => "");
      let errorCode: string | undefined;

      try {
        const json: unknown = JSON.parse(responseBody);

        if (Value.Check(DeviceErrorCode, json)) errorCode = json.error;
        else if (Value.Check(NestedDeviceErrorCode, json)) errorCode = json.error.code;
      } catch {}

      if (errorCode === "deviceauth_authorization_pending") {
        return { status: "pending" };
      }

      if (errorCode === "slow_down") {
        return { status: "slow_down" };
      }

      return {
        status: "failed",
        message: `OpenAI Codex device auth failed with status ${response.status}${responseBody ? `: ${responseBody}` : ""}`,
      };
    },
  });
}

async function createAuthorizationFlow(
  originator: string = ORIGINATOR,
): Promise<{ verifier: string; state: string; url: string }> {
  const { verifier, challenge } = await generatePKCE();
  const state = createState();

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", originator);

  return { verifier, state, url: url.toString() };
}

type OAuthServerInfo = {
  close: () => void;
  cancelWait: () => void;
  waitForCode: () => Promise<{ code: string } | null>;
};

function startLocalOAuthServer(state: string): Promise<OAuthServerInfo> {
  assertNodeRuntime();

  let settleWait: ((value: { code: string } | null) => void) | undefined;

  const waitForCodePromise = new Promise<{ code: string } | null>((resolve) => {
    let settled = false;
    settleWait = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });

  const server = process.getBuiltinModule("node:http").createServer((req, res) => {
    try {
      const url = new URL(req.url || "", "http://localhost");

      if (url.pathname !== "/auth/callback") {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          oauthErrorHtml(
            "Nyte is not listening on this path. Run the login command again to retry.",
          ),
        );

        return;
      }

      if (url.searchParams.get("state") !== state) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          oauthErrorHtml(
            "The callback's state did not match this login attempt, so Nyte ignored it.",
          ),
        );

        return;
      }

      const code = url.searchParams.get("code");

      if (!code) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          oauthErrorHtml(
            "The callback arrived without an authorization code, so Nyte could not finish sign-in.",
          ),
        );

        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(oauthSuccessHtml({ provider: "OpenAI" }));
      settleWait?.({ code });
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        oauthErrorHtml(
          "Nyte hit an internal error while handling the callback. Run the login command again to retry.",
        ),
      );
    }
  });

  return new Promise((resolve) => {
    server
      .listen(1455, getCallbackHost(), () => {
        resolve({
          close: () => server.close(),
          cancelWait: () => {
            settleWait?.(null);
          },
          waitForCode: () => waitForCodePromise,
        });
      })
      .on("error", (_err: NodeJS.ErrnoException) => {
        settleWait?.(null);
        resolve({
          close: () => {
            try {
              server.close();
            } catch {
              // ignore
            }
          },
          cancelWait: () => {},
          waitForCode: async () => null,
        });
      });
  });
}

// Nyte divergence: exported (pi keeps it module-private) because Nyte's legacy
// index.ts re-exports it for @nyte-ai/core until core migrates.
export function getAccountId(accessToken: string): string | null {
  return decodeJwt(accessToken)?.[JWT_CLAIM_PATH]?.chatgpt_account_id || null;
}

function credentialsFromToken(token: OAuthToken): OAuthCredential {
  const accountId = getAccountId(token.access);

  if (!accountId) {
    throw new Error("Failed to extract accountId from token");
  }

  return {
    type: "oauth",
    access: token.access,
    refresh: token.refresh,
    expires: token.expires,
    accountId,
  };
}

async function exchangeAuthorizationCodeForCredentials(
  code: string,
  verifier: string,
  redirectUri: string,
  signal: AbortSignal,
): Promise<OAuthCredential> {
  return credentialsFromToken(await exchangeAuthorizationCode(code, verifier, redirectUri, signal));
}

async function loginOpenAICodexDeviceCode(
  interaction: ProviderAuthInteraction,
): Promise<OAuthCredential> {
  const device = await startOpenAICodexDeviceAuth(interaction.signal);
  interaction.notify({
    type: "device_code",
    userCode: device.userCode,
    verificationUri: DEVICE_VERIFICATION_URI,
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS,
  });
  const code = await pollOpenAICodexDeviceAuth(device, interaction.signal);

  return exchangeAuthorizationCodeForCredentials(
    code.authorizationCode,
    code.codeVerifier,
    DEVICE_REDIRECT_URI,
    interaction.signal,
  );
}

async function loginOpenAICodex(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
  const { verifier, state, url } = await createAuthorizationFlow();
  const server = await startLocalOAuthServer(state);
  const manualAbort = new AbortController();
  const onAbort = () => server.cancelWait();
  interaction.signal.addEventListener("abort", onAbort, { once: true });

  if (interaction.signal.aborted) onAbort();
  let code: string | undefined;
  let manualCode: string | undefined;
  let manualError: Error | undefined;

  interaction.notify({
    type: "auth_url",
    url,
    instructions: "A browser window should open. Complete login to finish.",
  });

  try {
    const manualPromise = interaction
      .prompt({
        type: "manual_code",
        message:
          "Complete login in your browser, or paste the authorization code / redirect URL here:",
        placeholder: REDIRECT_URI,
        signal: manualAbort.signal,
      })
      .then((input) => {
        manualCode = input;
        server.cancelWait();
      })
      .catch((error) => {
        manualError = error instanceof Error ? error : new Error(String(error));
        server.cancelWait();
      });

    const result = await server.waitForCode();

    if (manualError) throw manualError;

    if (result?.code) {
      code = result.code;
    } else if (manualCode) {
      const parsed = parseAuthorizationInput(manualCode);

      if (parsed.state && parsed.state !== state) throw new Error("State mismatch");
      code = parsed.code;
    }

    if (!code) {
      await manualPromise;

      if (manualError) throw manualError;

      if (manualCode) {
        const parsed = parseAuthorizationInput(manualCode);

        if (parsed.state && parsed.state !== state) throw new Error("State mismatch");
        code = parsed.code;
      }
    }

    if (!code) throw new Error("Missing authorization code");

    return exchangeAuthorizationCodeForCredentials(
      code,
      verifier,
      REDIRECT_URI,
      interaction.signal,
    );
  } finally {
    interaction.signal.removeEventListener("abort", onAbort);
    manualAbort.abort();
    server.close();
  }
}

/**
 * Refresh OpenAI Codex OAuth token
 */
async function refreshOpenAICodexToken(
  refreshToken: string,
  signal: AbortSignal,
): Promise<OAuthCredential> {
  return credentialsFromToken(await refreshAccessToken(refreshToken, signal));
}

export const openaiCodexOAuth: OAuthAuth = {
  name: "OpenAI (ChatGPT Plus/Pro)",
  isSubscription: true,

  async login(interaction) {
    const method = await interaction.prompt({
      type: "select",
      message: "Select OpenAI Codex login method:",
      options: [
        { id: OPENAI_CODEX_BROWSER_LOGIN_METHOD, label: "Browser login (default)" },
        { id: OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD, label: "Device code login (headless)" },
      ],
    });

    if (method === OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD) {
      return loginOpenAICodexDeviceCode(interaction);
    }

    if (method !== OPENAI_CODEX_BROWSER_LOGIN_METHOD) {
      throw new Error(`Unknown OpenAI Codex login method: ${method}`);
    }

    return loginOpenAICodex(interaction);
  },

  refresh: (credential, signal) => refreshOpenAICodexToken(credential.refresh, signal),

  async toAuth(credential) {
    // Nyte divergence: Nyte's legacy Responses adapter only sees ModelAuth, so
    // the ChatGPT account header rides along here until core migrates.
    const accountId = getAccountId(credential.access);

    if (!accountId) throw new Error("OpenAI Codex credential missing account id");

    return { apiKey: credential.access, headers: { "chatgpt-account-id": accountId } };
  },
};
