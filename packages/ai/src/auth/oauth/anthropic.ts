/**
 * Anthropic OAuth flow (Claude Pro/Max): PKCE against claude.ai, a localhost
 * callback server on port 53692 raced against a manual paste prompt, and
 * token refresh against platform.claude.com. Node-only (node:http); the
 * callback server is for CLI use, not browsers.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/auth/oauth/anthropic.ts
 * Synced with pi 7ebf9087e.
 */

import { createServer, type Server } from "node:http";
import { Value } from "typebox/value";
import { getProviderEnvValue } from "../../utils/provider-env.ts";
import {
  OAuthTokenResponseSchema,
  type OAuthAuth,
  type OAuthCredential,
  type ProviderAuthInteraction,
} from "../types.ts";
import { oauthErrorHtml, oauthSuccessHtml } from "./oauth-page.ts";
import { generatePKCE } from "./pkce.ts";

type CallbackServerInfo = {
  server: Server;
  redirectUri: string;
  cancelWait: () => void;
  waitForCode: () => Promise<{ code: string; state: string } | null>;
};

const decode = (s: string) => atob(s);

const CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");

const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";

const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";

const CALLBACK_HOST = getProviderEnvValue("NYTE_OAUTH_CALLBACK_HOST") || "127.0.0.1";

const CALLBACK_PORT = 53692;

const CALLBACK_PATH = "/callback";

const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

const SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

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

function formatErrorDetails(cause: unknown): string {
  if (cause instanceof Error) {
    const details: string[] = [`${cause.name}: ${cause.message}`];

    if ("code" in cause && cause.code) details.push(`code=${String(cause.code)}`);

    if ("errno" in cause && cause.errno !== undefined) details.push(`errno=${String(cause.errno)}`);

    if (cause.cause !== undefined) {
      details.push(`cause=${formatErrorDetails(cause.cause)}`);
    }

    if (cause.stack) {
      details.push(`stack=${cause.stack}`);
    }

    return details.join("; ");
  }

  return String(cause);
}

async function startCallbackServer(expectedState: string): Promise<CallbackServerInfo> {
  return new Promise((resolve, reject) => {
    let settleWait: ((value: { code: string; state: string } | null) => void) | undefined;

    const waitForCodePromise = new Promise<{ code: string; state: string } | null>(
      (resolveWait) => {
        let settled = false;
        settleWait = (value) => {
          if (settled) return;
          settled = true;
          resolveWait(value);
        };
      },
    );

    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url || "", "http://localhost");

        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            oauthErrorHtml(
              "Nyte is not listening on this path. Run the login command again to retry.",
            ),
          );

          return;
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            oauthErrorHtml(
              "Anthropic sent back an error instead of a code. Run the login command again to retry.",
              `Error: ${error}`,
            ),
          );

          return;
        }

        if (!code || !state) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            oauthErrorHtml(
              "The callback arrived without a code or state, so Nyte could not finish sign-in.",
            ),
          );

          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            oauthErrorHtml(
              "The callback's state did not match this login attempt, so Nyte ignored it.",
            ),
          );

          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(oauthSuccessHtml({ provider: "Anthropic" }));
        settleWait?.({ code, state });
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal error");
      }
    });

    server.on("error", (err) => {
      reject(err);
    });

    server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
      resolve({
        server,
        redirectUri: REDIRECT_URI,
        cancelWait: () => {
          settleWait?.(null);
        },
        waitForCode: () => waitForCodePromise,
      });
    });
  });
}

async function postJson(
  url: string,
  body: Record<string, string | number>,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `HTTP request failed. status=${response.status}; url=${url}; body=${responseBody}`,
    );
  }

  return responseBody;
}

async function exchangeAuthorizationCode(
  code: string,
  state: string,
  verifier: string,
  redirectUri: string,
  signal: AbortSignal,
): Promise<OAuthCredential> {
  let responseBody: string;

  try {
    responseBody = await postJson(
      TOKEN_URL,
      {
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code,
        state,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      },
      signal,
    );
  } catch (error) {
    throw new Error(
      `Token exchange request failed. url=${TOKEN_URL}; redirect_uri=${redirectUri}; response_type=authorization_code; details=${formatErrorDetails(error)}`,
    );
  }

  let tokenData: unknown;

  try {
    tokenData = JSON.parse(responseBody);
  } catch (error) {
    throw new Error(
      `Token exchange returned invalid JSON. url=${TOKEN_URL}; body=${responseBody}; details=${formatErrorDetails(error)}`,
    );
  }

  if (!Value.Check(OAuthTokenResponseSchema, tokenData)) {
    throw new Error(`Token exchange returned an incomplete token response. url=${TOKEN_URL}`);
  }

  return {
    type: "oauth",
    refresh: tokenData.refresh_token,
    access: tokenData.access_token,
    expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
  };
}

async function loginAnthropic(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
  const { verifier, challenge } = await generatePKCE();
  const server = await startCallbackServer(verifier);
  const manualAbort = new AbortController();

  const onAbort = () => {
    server.cancelWait();
    server.server.close();
  };

  interaction.signal.addEventListener("abort", onAbort, { once: true });

  if (interaction.signal.aborted) onAbort();
  let code: string | undefined;
  let state: string | undefined;
  let manualInput: string | undefined;
  let manualError: Error | undefined;

  try {
    const authParams = new URLSearchParams({
      code: "true",
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: verifier,
    });

    interaction.notify({
      type: "auth_url",
      url: `${AUTHORIZE_URL}?${authParams.toString()}`,
      instructions:
        "Complete login in your browser. If the browser is on another machine, paste the final redirect URL here.",
    });

    const manualPromise = interaction
      .prompt({
        type: "manual_code",
        message:
          "Complete login in your browser, or paste the authorization code / redirect URL here:",
        placeholder: REDIRECT_URI,
        signal: manualAbort.signal,
      })
      .then((input) => {
        manualInput = input;
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
      state = result.state;
    } else if (manualInput) {
      const parsed = parseAuthorizationInput(manualInput);

      if (parsed.state && parsed.state !== verifier) throw new Error("OAuth state mismatch");
      code = parsed.code;
      state = parsed.state ?? verifier;
    }

    if (!code) {
      await manualPromise;

      if (manualError) throw manualError;

      if (manualInput) {
        const parsed = parseAuthorizationInput(manualInput);

        if (parsed.state && parsed.state !== verifier) throw new Error("OAuth state mismatch");
        code = parsed.code;
        state = parsed.state ?? verifier;
      }
    }

    if (!code) throw new Error("Missing authorization code");

    if (!state) throw new Error("Missing OAuth state");
    interaction.notify({
      type: "progress",
      message: "Exchanging authorization code for tokens...",
    });

    return exchangeAuthorizationCode(code, state, verifier, REDIRECT_URI, interaction.signal);
  } finally {
    interaction.signal.removeEventListener("abort", onAbort);
    manualAbort.abort();
    server.server.close();
  }
}

/**
 * Refresh Anthropic OAuth token
 */
async function refreshAnthropicToken(
  refreshToken: string,
  signal: AbortSignal,
): Promise<OAuthCredential> {
  let responseBody: string;

  try {
    responseBody = await postJson(
      TOKEN_URL,
      {
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      },
      signal,
    );
  } catch (error) {
    throw new Error(
      `Anthropic token refresh request failed. url=${TOKEN_URL}; details=${formatErrorDetails(error)}`,
    );
  }

  let data: unknown;

  try {
    data = JSON.parse(responseBody);
  } catch (error) {
    throw new Error(
      `Anthropic token refresh returned invalid JSON. url=${TOKEN_URL}; body=${responseBody}; details=${formatErrorDetails(error)}`,
    );
  }

  if (!Value.Check(OAuthTokenResponseSchema, data)) {
    throw new Error(
      `Anthropic token refresh returned an incomplete token response. url=${TOKEN_URL}`,
    );
  }

  return {
    type: "oauth",
    refresh: data.refresh_token,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}

export const anthropicOAuth: OAuthAuth = {
  name: "Anthropic (Claude Pro/Max)",
  isSubscription: true,
  login: loginAnthropic,
  refresh: (credential, signal) => refreshAnthropicToken(credential.refresh, signal),

  async toAuth(credential) {
    return { apiKey: credential.access };
  },
};
