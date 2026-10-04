/**
 * Anthropic OAuth flow (Claude Pro/Max): PKCE against claude.ai with browser
 * callback or copy-code login, and token refresh against platform.claude.com.
 * Node-only (node:http); the callback server is for CLI use, not browsers.
 *
 * Based on https://github.com/earendil-works/pi/blob/83692682f095528f8b71652ddacff7075e36e893/packages/ai/src/auth/oauth/anthropic.ts
 * Login methods aligned with pi 83692682f; Nyte owns callback handling and token validation.
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
import { parseAuthorizationInput } from "./authorization-input.ts";
import { oauthErrorHtml, oauthSuccessHtml } from "./oauth-page.ts";
import { generatePKCE } from "./pkce.ts";

type CallbackServerInfo = {
  server: Server;
  redirectUri: string;
  cancelWait: () => void;
  failWait: (error: Error) => void;
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

const COPY_CODE_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";

const SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

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
    let settleWait: ((value: { code: string; state: string } | Error | null) => void) | undefined;

    const waitForCodePromise = new Promise<{ code: string; state: string } | null>(
      (resolveWait, rejectWait) => {
        let settled = false;
        settleWait = (value) => {
          if (settled) return;
          settled = true;

          if (value instanceof Error) rejectWait(value);
          else resolveWait(value);
        };
      },
    );

    waitForCodePromise.catch(() => undefined);

    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url || "", "http://localhost");

        if (req.method !== "GET" || url.pathname !== CALLBACK_PATH) {
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

        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            oauthErrorHtml(
              "The callback's state did not match this login attempt, so Nyte ignored it.",
            ),
          );

          return;
        }

        if (error) {
          const description = url.searchParams.get("error_description") ?? error;
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            oauthErrorHtml(
              "Anthropic sent back an error instead of a code. Run the login command again to retry.",
              `Error: ${description}`,
            ),
          );
          settleWait?.(new Error(`Anthropic authorization failed: ${description}`));

          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            oauthErrorHtml(
              "The callback arrived without a code, so Nyte could not finish sign-in.",
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
        failWait: (error) => {
          settleWait?.(error);
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

async function loginAnthropic(
  interaction: ProviderAuthInteraction,
  method: "browser" | "copy_code",
): Promise<OAuthCredential> {
  const { verifier, challenge } = await generatePKCE();
  const redirectUri = method === "copy_code" ? COPY_CODE_REDIRECT_URI : REDIRECT_URI;
  const server =
    method === "browser" ? await startCallbackServer(verifier).catch(() => undefined) : undefined;
  const manualAbort = new AbortController();

  const onAbort = () => {
    server?.failWait(new Error("Login cancelled"));
    manualAbort.abort();
    server?.server.close();
  };

  interaction.signal.addEventListener("abort", onAbort, { once: true });

  if (interaction.signal.aborted) onAbort();
  let manualInput: string | undefined;
  let manualError: Error | undefined;

  try {
    if (interaction.signal.aborted) throw new Error("Login cancelled");

    const authParams = new URLSearchParams({
      code: "true",
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: verifier,
    });

    interaction.notify({
      type: "auth_url",
      url: `${AUTHORIZE_URL}?${authParams.toString()}`,
      instructions:
        method === "copy_code"
          ? "Complete login in your browser, then copy the code Anthropic shows and paste it here."
          : "Complete login in your browser. If the browser is on another machine, paste the final redirect URL here.",
    });

    const manualPromise = interaction
      .prompt({
        type: "manual_code",
        message:
          method === "copy_code"
            ? "Paste the code Anthropic shows after you sign in:"
            : "Complete login in your browser, or paste the authorization code / redirect URL here:",
        placeholder: method === "copy_code" ? "code#state" : REDIRECT_URI,
        signal: manualAbort.signal,
      })
      .then((input) => {
        manualInput = input;
        server?.cancelWait();
      })
      .catch((error) => {
        manualError = error instanceof Error ? error : new Error(String(error));
        server?.cancelWait();
      });

    const result = await server?.waitForCode();

    if (!result) await manualPromise;
    if (interaction.signal.aborted) throw new Error("Login cancelled");
    if (manualError) throw manualError;

    const parsed = result ?? parseAuthorizationInput(manualInput ?? "");
    if (parsed.state && parsed.state !== verifier) throw new Error("OAuth state mismatch");
    if (!parsed.code) throw new Error("Missing authorization code");

    interaction.notify({
      type: "progress",
      message: "Exchanging authorization code for tokens...",
    });

    return exchangeAuthorizationCode(
      parsed.code,
      parsed.state ?? verifier,
      verifier,
      redirectUri,
      interaction.signal,
    );
  } finally {
    interaction.signal.removeEventListener("abort", onAbort);
    manualAbort.abort();
    server?.server.close();
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
  async login(interaction) {
    if (interaction.signal.aborted) throw new Error("Login cancelled");

    const method = await interaction.prompt({
      type: "select",
      message: "Select Anthropic login method:",
      options: [
        { id: "browser", label: "Browser login (default)" },
        { id: "copy_code", label: "Copy code login (headless)" },
      ],
      signal: interaction.signal,
    });

    if (interaction.signal.aborted) throw new Error("Login cancelled");
    if (method !== "browser" && method !== "copy_code") {
      throw new Error(`Unknown Anthropic login method: ${method}`);
    }

    return loginAnthropic(interaction, method);
  },
  refresh: (credential, signal) => refreshAnthropicToken(credential.refresh, signal),

  async toAuth(credential) {
    return { apiKey: credential.access };
  },
};
