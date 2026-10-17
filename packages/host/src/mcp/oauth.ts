import { createHash } from "node:crypto";
import type { AuthProvider, McpFetch } from "@earendil-works/pi-mcp";
import {
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  OAuthCallbackServer,
  authorizeMcp,
  parseWwwAuthenticate,
  stepUpScope,
} from "@earendil-works/pi-mcp/oauth";
import type {
  McpOAuthState,
  McpOAuthStateStore,
  OAuthChallenge,
  OAuthClientInformationMixed,
} from "@earendil-works/pi-mcp/oauth";
import { closable } from "@nyte-ai/core";
import type { Login, PluginStorage } from "@nyte-ai/core";
import { Type } from "typebox";
import { Value } from "typebox/value";

const CALLBACK_HOST = "127.0.0.1";

const CALLBACK_PATH = "/callback";

const FALLBACK_REDIRECT_URL = `http://${CALLBACK_HOST}${CALLBACK_PATH}`;

const REFRESH_SKEW_MS = 30_000;

const REQUEST_TIMEOUT_MS = 15_000;

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

/** A server's OAuth options with `${VAR}`s resolved. */
export type McpOAuthSettings = {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly callbackPort?: number;
  readonly callbackUrl?: string;
  readonly clientName?: string;
  readonly scope?: string;
  readonly authServerMetadataUrl?: URL;
};

const tokens = Type.Object({
  access_token: Type.String(),
  token_type: Type.String(),
  expires_in: Type.Optional(Type.Number()),
  scope: Type.Optional(Type.String()),
  refresh_token: Type.Optional(Type.String()),
  id_token: Type.Optional(Type.String()),
});

const storedState = Type.Object({
  serverUrl: Type.String(),
  clientInformation: Type.Optional(
    Type.Object({
      client_id: Type.String(),
      client_secret: Type.Optional(Type.String()),
      client_id_issued_at: Type.Optional(Type.Number()),
      client_secret_expires_at: Type.Optional(Type.Number()),
      redirect_uris: Type.Optional(Type.Array(Type.String())),
    }),
  ),
  tokens: Type.Optional(tokens),
  tokensExpireAt: Type.Optional(Type.Number()),
  codeVerifier: Type.Optional(Type.String()),
  oauthState: Type.Optional(Type.String()),
});

/** The secret a server's OAuth state lives under: by name and URL, so one URL under two names signs in twice. */
export function oauthKey(server: string, url: string): string {
  return `oauth:${server}:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

/** Keeps one server's OAuth state in the host's sealed secrets. */
export function oauthStore(secrets: PluginStorage["secrets"], key: string): McpOAuthStateStore {
  return {
    async load() {
      const text = await secrets.get(key);
      const parsed: unknown = text === undefined ? undefined : JSON.parse(text);

      return Value.Check(storedState, parsed) ? parsed : undefined;
    },
    save: (state) => secrets.set(key, JSON.stringify({ ...state, discovery: undefined })),
  };
}

/**
 * Sends a connection's stored access token and refreshes it before it
 * expires or after a 401, one refresh at a time. It never opens a browser:
 * when only a new sign-in helps, including a server asking for more scope,
 * it throws `McpOAuthAuthorizationRequiredError`. `onChallenge` keeps the
 * server's `WWW-Authenticate` challenge for the sign-in.
 */
export function createAuthProvider(input: {
  readonly serverUrl: string;
  readonly store: McpOAuthStateStore;
  readonly settings: () => McpOAuthSettings;
  onChallenge(challenge: OAuthChallenge): void;
}): AuthProvider {
  const { serverUrl, store } = input;
  let refreshing: Promise<void> | undefined;

  const refresh = (
    stale: string | undefined,
    fetch: McpFetch = globalThis.fetch,
    challenge?: OAuthChallenge,
  ): Promise<void> => {
    refreshing ??= (async () => {
      const state = await store.load();

      if (state?.tokens?.access_token !== stale) return;

      if (state?.tokens?.refresh_token === undefined)
        throw new McpOAuthAuthorizationRequiredError();
      const settings = input.settings();

      const redirectUrl =
        fixedRedirectUrl(settings) ??
        registeredRedirectUrls(state.clientInformation)[0] ??
        FALLBACK_REDIRECT_URL;

      const provider = createProvider(serverUrl, store, settings, redirectUrl, () => undefined);

      const result = await authorizeMcp(provider, {
        serverUrl,
        resourceMetadataUrl: challenge?.resourceMetadataUrl,
        authorizationServerMetadataUrl: settings.authServerMetadataUrl,
        scope: challenge?.scope,
        fetch: timedFetch(fetch),
      });

      if (result === "REDIRECT") throw new McpOAuthAuthorizationRequiredError();
    })().finally(() => {
      refreshing = undefined;
    });

    return refreshing;
  };

  return {
    async token() {
      await refreshing?.catch(() => undefined);
      const state = await store.load();
      const token = state?.tokens?.access_token;

      const expired =
        state?.tokensExpireAt !== undefined && state.tokensExpireAt - REFRESH_SKEW_MS <= Date.now();

      if (!expired || state?.tokens?.refresh_token === undefined) return token;
      await refresh(token).catch(() => undefined);

      return (await store.load())?.tokens?.access_token;
    },
    async onUnauthorized(context) {
      const challenge = parseWwwAuthenticate(context.response.headers.get("www-authenticate"));
      input.onChallenge(challenge);

      if (challenge.error === "insufficient_scope") throw new McpOAuthAuthorizationRequiredError();
      await refresh(context.token, context.fetch, challenge);
    },
  };
}

type LoginStep = ReturnType<Login["steps"]> extends AsyncIterable<infer Step> ? Step : never;

/**
 * Signs in to a server: refreshes stored tokens when that is enough, or
 * runs the browser authorization code flow against a loopback callback.
 * The returned login's steps are `open` (the authorization page), `paste`
 * (answer with the redirect URL when the browser cannot reach this
 * machine), then `done` or `failed`. Ending the steps cancels the sign-in.
 */
export function signIn(input: {
  readonly server: string;
  readonly serverUrl: string;
  readonly store: McpOAuthStateStore;
  readonly settings: McpOAuthSettings;
  readonly challenge: OAuthChallenge | null;
  signedIn(): void;
  ended(): void;
}): Login {
  const queued: LoginStep[] = [];
  const wakers = new Set<() => void>();
  let pasted: PromiseWithResolvers<string> | null = null;
  const controller = new AbortController();

  const deliver = (step: LoginStep): void => {
    queued.push(step);

    for (const wake of wakers) wake();
    wakers.clear();
  };

  void (async () => {
    try {
      await authorize({
        ...input,
        signal: controller.signal,
        show(url) {
          deliver({ kind: "open", url: url.href });
          pasted = Promise.withResolvers();
          deliver({
            kind: "paste",
            message: "If the browser can't reach this machine, paste the URL it ended on",
            secret: false,
          });

          return pasted.promise;
        },
      });
      input.signedIn();
      deliver({ kind: "done" });
    } catch (error) {
      deliver({
        kind: "failed",
        reason: controller.signal.aborted
          ? "Sign-in cancelled."
          : `Sign-in to ${input.server} failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      input.ended();
    }
  })();

  return {
    steps: () =>
      closable<LoginStep>(() => {
        let finished = false;

        return {
          async pull() {
            if (finished) return { done: true, value: undefined };
            let step = queued.shift();

            while (step === undefined && !controller.signal.aborted) {
              await new Promise<void>((resolve) => wakers.add(resolve));
              step = queued.shift();
            }

            if (step === undefined) return { done: true, value: undefined };
            finished = step.kind === "done" || step.kind === "failed";

            return { done: false, value: step };
          },
          close() {
            controller.abort();

            for (const wake of wakers) wake();
            wakers.clear();
          },
        };
      }),
    async answer(code) {
      pasted?.resolve(code);
    },
  };
}

async function authorize(input: {
  readonly serverUrl: string;
  readonly store: McpOAuthStateStore;
  readonly settings: McpOAuthSettings;
  readonly challenge: OAuthChallenge | null;
  readonly signal: AbortSignal;
  show(url: URL): Promise<string>;
}): Promise<void> {
  const { serverUrl, store, settings, challenge, signal } = input;
  const stored = await store.load();
  const stepUp = challenge?.error === "insufficient_scope";
  const fixed = fixedRedirectUrl(settings);
  const configured = new URL(settings.callbackUrl ?? `http://${CALLBACK_HOST}${CALLBACK_PATH}`);
  const registered = registeredRedirectUrls(stored?.clientInformation)[0];
  const configuredPort = configured.port === "" ? settings.callbackPort : Number(configured.port);

  const preferred =
    configuredPort ??
    (registered === undefined ? undefined : Number(new URL(registered).port) || undefined);

  const callback = await listen(configured, preferred, configuredPort !== undefined);
  const redirectUrl = fixed ?? callback.redirectUrl;

  try {
    if (stored !== undefined) {
      const keep =
        settings.clientId !== undefined ||
        registeredRedirectUrls(stored.clientInformation).includes(redirectUrl);

      const next: McpOAuthState = keep
        ? { ...stored, oauthState: undefined }
        : { serverUrl: stored.serverUrl };

      await store.save(next);
    }

    let authorizationUrl: URL | undefined;

    const provider = createProvider(serverUrl, store, settings, redirectUrl, (url) => {
      authorizationUrl = url;
    });

    const flow = {
      serverUrl,
      fetch: timedFetch(),
      signal,
      resourceMetadataUrl: challenge?.resourceMetadataUrl,
      authorizationServerMetadataUrl: settings.authServerMetadataUrl,
      scope: mergeScopes(
        settings.scope,
        stepUp ? stepUpScope(stored?.tokens?.scope, challenge?.scope) : challenge?.scope,
      ),
    };

    if ((await authorizeMcp(provider, { ...flow, skipRefresh: stepUp })) === "AUTHORIZED") return;

    if (authorizationUrl === undefined)
      throw new Error("The server did not give an authorization page.");
    const state = await provider.state();
    const expected = new URL(authorizationUrl.searchParams.get("redirect_uri") ?? redirectUrl);
    signal.throwIfAborted();
    const pasted = input.show(authorizationUrl);

    const response = await Promise.race([
      callback.waitForCallback(state, expected.pathname),
      pasted.then((text) => fromRedirectUrl(text, state, expected)),
      new Promise<never>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Sign-in cancelled.")), {
          once: true,
        }),
      ),
    ]);

    await authorizeMcp(provider, { ...flow, authorizationCode: response.code, iss: response.iss });
  } finally {
    await callback.close();
  }
}

function fromRedirectUrl(
  text: string,
  state: string,
  expected: URL,
): { readonly code: string; readonly iss: string | undefined } {
  const url = URL.parse(text.trim());

  if (url === null) throw new Error("Paste the full URL from the browser's address bar.");

  if (url.origin !== expected.origin || url.pathname !== expected.pathname)
    throw new Error("That URL is not this sign-in's redirect.");
  const error = url.searchParams.get("error");

  if (error !== null) throw new Error(url.searchParams.get("error_description") ?? error);

  if (url.searchParams.get("state") !== state)
    throw new Error("That URL belongs to a different sign-in.");
  const code = url.searchParams.get("code");

  if (code === null) throw new Error("That URL has no authorization code.");

  return { code, iss: url.searchParams.get("iss") ?? undefined };
}

async function listen(
  configured: URL,
  port: number | undefined,
  required: boolean,
): Promise<OAuthCallbackServer> {
  const address = configured.hostname.replace(/^\[|\]$/g, "");

  const options = {
    host: address === "localhost" ? CALLBACK_HOST : address,
    redirectHost: address,
    path: configured.pathname,
    timeoutMs: SIGN_IN_TIMEOUT_MS,
  };

  try {
    return await OAuthCallbackServer.listen({ ...options, port: port ?? 0 });
  } catch (error) {
    if (required || port === undefined) throw error;

    return OAuthCallbackServer.listen(options);
  }
}

function fixedRedirectUrl(settings: McpOAuthSettings): string | undefined {
  if (settings.callbackUrl !== undefined && new URL(settings.callbackUrl).port !== "")
    return settings.callbackUrl;

  if (settings.callbackPort === undefined) return undefined;
  const url = new URL(settings.callbackUrl ?? `http://${CALLBACK_HOST}${CALLBACK_PATH}`);
  url.port = String(settings.callbackPort);

  return url.href;
}

function createProvider(
  serverUrl: string,
  store: McpOAuthStateStore,
  settings: McpOAuthSettings,
  redirectUrl: string,
  onRedirect: (url: URL) => void,
): McpOAuthProvider {
  return new McpOAuthProvider({
    serverUrl,
    redirectUrl,
    clientMetadata: { client_name: settings.clientName ?? "Nyte" },
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    store,
    onRedirect,
  });
}

function registeredRedirectUrls(client: OAuthClientInformationMixed | undefined): string[] {
  return client !== undefined && "redirect_uris" in client ? client.redirect_uris : [];
}

function mergeScopes(...scopes: (string | undefined)[]): string | undefined {
  const merged = [...new Set(scopes.flatMap((scope) => scope?.split(/\s+/).filter(Boolean) ?? []))];

  return merged.length > 0 ? merged.join(" ") : undefined;
}

function timedFetch(fetch: McpFetch = globalThis.fetch): McpFetch {
  return (url, init) => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    return fetch(url, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  };
}
