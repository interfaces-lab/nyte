/**
 * Based on https://github.com/earendil-works/pi/blob/main/packages/ai/test/anthropic-oauth.test.ts
 * and https://github.com/earendil-works/pi/blob/main/packages/ai/test/oauth-callback-server.test.ts
 * Synced with pi a276dabe5.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { afterEach, describe, test, vi } from "vitest";
import { anthropicOAuth } from "../src/auth/oauth/anthropic.ts";
import type { AuthPrompt, OAuthCredential } from "../src/auth/types.ts";

const neverAbortedSignal = new AbortController().signal;
const nativeFetch = globalThis.fetch;
const CALLBACK_URL = "http://127.0.0.1:53692/callback";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const LOGIN_METHODS = [
  { method: "browser", redirectUri: "http://localhost:53692/callback" },
  { method: "copy_code", redirectUri: "https://platform.claude.com/oauth/code/callback" },
] satisfies { method: "browser" | "copy_code"; redirectUri: string }[];

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function getUrl(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (input instanceof Request) {
    return input.url;
  }
  throw new Error(`Unsupported fetch input: ${String(input)}`);
}

function getJsonBody(init?: RequestInit): Record<string, string> {
  if (typeof init?.body !== "string") {
    throw new Error(`Expected string request body, got ${typeof init?.body}`);
  }
  const body: unknown = JSON.parse(init.body);
  assert.ok(Value.Check(Type.Record(Type.String(), Type.String()), body));
  return body;
}

function callbackUrl(params: Record<string, string>): string {
  const url = new URL(CALLBACK_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function page(
  response: Response,
): Promise<{ status: number; contentType: string | null; body: string }> {
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  };
}

/** A manual prompt that stays open until its signal aborts. */
function pendingPrompt(
  onPrompt?: (prompt: AuthPrompt) => void,
): (prompt: AuthPrompt) => Promise<string> {
  return (prompt) => {
    onPrompt?.(prompt);
    return new Promise((_, reject) => {
      prompt.signal?.addEventListener("abort", () => reject(new Error("prompt aborted")), {
        once: true,
      });
    });
  };
}

function startLogin(
  prompt: (prompt: AuthPrompt) => Promise<string>,
  signal: AbortSignal = neverAbortedSignal,
  method: "browser" | "copy_code" = "browser",
): { state: Promise<string>; credential: Promise<OAuthCredential> } {
  const state = Promise.withResolvers<string>();
  const credential = anthropicOAuth.login({
    signal,
    notify: (event) => {
      if (event.type === "auth_url") {
        state.resolve(new URL(event.url).searchParams.get("state") ?? "");
      }
    },
    prompt: async (request) => {
      if (request.type === "select") return method;
      assert.equal(request.type, "manual_code");
      return prompt(request);
    },
  });
  return { state: state.promise, credential };
}

function stubTokenExchange(exchange: (code: string) => Promise<Response>): string[] {
  const codes: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
      assert.equal(getUrl(input), TOKEN_URL);
      const code = getJsonBody(init).code;
      codes.push(code);
      return exchange(code);
    }),
  );
  return codes;
}

const tokens = () =>
  Promise.resolve(
    jsonResponse({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }),
  );

describe("Anthropic OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test.each(LOGIN_METHODS)(
    "uses the $method redirect_uri for authorization and token exchange",
    async ({ method, redirectUri }) => {
      let authUrl = "";
      const prompts: AuthPrompt["type"][] = [];
      const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
        assert.equal(getUrl(input), TOKEN_URL);
        assert.equal(init?.method, "POST");
        const body = getJsonBody(init);
        const params = new URL(authUrl).searchParams;
        assert.equal(body.grant_type, "authorization_code");
        assert.equal(body.client_id, params.get("client_id"));
        assert.equal(body.code, "manual-code");
        assert.equal(body.redirect_uri, redirectUri);
        assert.equal(params.get("redirect_uri"), redirectUri);
        assert.equal(params.get("response_type"), "code");
        assert.ok(params.get("state"));
        assert.equal(body.state, params.get("state"));
        assert.ok(body.code_verifier);
        assert.equal(params.get("code_challenge_method"), "S256");
        assert.equal(
          params.get("code_challenge"),
          createHash("sha256").update(body.code_verifier).digest("base64url"),
        );
        return jsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const credentials = await anthropicOAuth.login({
        signal: neverAbortedSignal,
        notify: (event) => {
          if (event.type === "auth_url") authUrl = event.url;
        },
        prompt: async (prompt) => {
          prompts.push(prompt.type);
          if (prompt.type === "select") {
            assert.equal(authUrl, "");
            assert.deepEqual(
              prompt.options.map((option) => option.id),
              ["browser", "copy_code"],
            );
            return method;
          }
          if (prompt.type !== "manual_code") throw new Error(`Unexpected prompt: ${prompt.type}`);
          if (method === "copy_code") {
            const probe = createServer();
            await new Promise<void>((resolve, reject) => {
              probe.once("error", reject);
              probe.listen(53692, "127.0.0.1", resolve);
            });
            await new Promise<void>((resolve) => probe.close(() => resolve()));
          }
          const url = new URL(authUrl);
          const state = url.searchParams.get("state");
          assert.ok(state);
          return `${redirectUri}?code=manual-code&state=${state}`;
        },
      });

      assert.equal(credentials.access, "access-token");
      assert.equal(credentials.refresh, "refresh-token");
      assert.deepEqual(prompts, ["select", "manual_code"]);
      assert.equal(fetchMock.mock.calls.length, 1);
    },
  );

  test("omits scope from refresh token requests", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
      assert.equal(getUrl(input), TOKEN_URL);
      assert.equal(init?.method, "POST");
      const body = getJsonBody(init);
      assert.equal(body.grant_type, "refresh_token");
      assert.ok(body.client_id);
      assert.equal(body.refresh_token, "refresh-token");
      assert.ok(!("scope" in body));
      return jsonResponse({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const credentials = await anthropicOAuth.refresh(
      {
        type: "oauth",
        access: "old-access-token",
        refresh: "refresh-token",
        expires: 0,
      },
      neverAbortedSignal,
    );

    assert.equal(credentials.access, "new-access-token");
    assert.equal(credentials.refresh, "new-refresh-token");
    assert.equal(fetchMock.mock.calls.length, 1);
  });
});

describe("Anthropic OAuth callback server", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("ignores stray requests, completes through the browser callback, and aborts the manual prompt", async () => {
    const codes = stubTokenExchange(tokens);
    let manualSignal: AbortSignal | undefined;
    const login = startLogin(
      pendingPrompt((prompt) => {
        manualSignal = prompt.signal;
      }),
    );
    const state = await login.state;

    const wrongPath = await page(await nativeFetch(new URL("/other", CALLBACK_URL)));
    assert.equal(wrongPath.status, 404);
    const wrongState = await page(await nativeFetch(callbackUrl({ code: "c", state: "other" })));
    assert.equal(wrongState.status, 400);
    assert.equal(wrongState.contentType, "text/html; charset=utf-8");
    assert.ok(wrongState.body.includes("state did not match this login attempt"));
    const post = await nativeFetch(callbackUrl({ code: "c", state }), { method: "POST" });
    assert.equal(post.status, 404);
    const missingCode = await page(await nativeFetch(callbackUrl({ state })));
    assert.equal(missingCode.status, 400);

    const success = await page(await nativeFetch(callbackUrl({ code: "the-code", state })));
    assert.equal(success.status, 200);
    assert.equal(success.contentType, "text/html; charset=utf-8");
    assert.ok(success.body.includes("Signed in to Anthropic"));
    assert.equal((await login.credential).access, "access");
    assert.deepEqual(codes, ["the-code"]);
    assert.equal(manualSignal?.aborted, true);
  });

  test("rejects login when the token exchange after the callback fails", async () => {
    stubTokenExchange(async () => {
      throw new Error("token exchange failed");
    });
    const login = startLogin(pendingPrompt());
    const rejected = assert.rejects(login.credential, /token exchange failed/);
    await nativeFetch(callbackUrl({ code: "c", state: await login.state }));
    await rejected;
  });

  test("rejects the wait when the provider redirects with an error", async () => {
    const codes = stubTokenExchange(tokens);
    const login = startLogin(pendingPrompt());
    const rejected = assert.rejects(login.credential, {
      message: "Anthropic authorization failed: User denied access",
    });
    const failure = await page(
      await nativeFetch(
        callbackUrl({
          error: "access_denied",
          error_description: "User denied access",
          state: await login.state,
        }),
      ),
    );
    assert.equal(failure.status, 400);
    assert.ok(failure.body.includes("User denied access"));
    await rejected;
    assert.deepEqual(codes, []);
  });

  test("ends the wait when the manual prompt wins and when the login is aborted", async () => {
    const exchange = Promise.withResolvers<Response>();
    const codes = stubTokenExchange(() => exchange.promise);
    const pasted = startLogin(async () => "pasted");
    const state = await pasted.state;

    await vi.waitFor(() => assert.deepEqual(codes, ["pasted"]));
    await assert.rejects(nativeFetch(callbackUrl({ code: "c", state })));
    exchange.resolve(await tokens());
    assert.equal((await pasted.credential).access, "access");
    assert.deepEqual(codes, ["pasted"]);

    for (const { method } of LOGIN_METHODS) {
      const controller = new AbortController();
      const aborted = startLogin(pendingPrompt(), controller.signal, method);
      await aborted.state;
      controller.abort();
      await assert.rejects(aborted.credential, { message: "Login cancelled" });

      const alreadyAborted = new AbortController();
      alreadyAborted.abort();
      await assert.rejects(startLogin(pendingPrompt(), alreadyAborted.signal, method).credential, {
        message: "Login cancelled",
      });
    }
    assert.deepEqual(codes, ["pasted"]);
  });

  test.each(LOGIN_METHODS)(
    "completes $method login manually on its original redirect when the port is taken",
    async ({ method, redirectUri }) => {
      const blocker: Server = createServer();
      await new Promise<void>((resolve) => blocker.listen(53692, "127.0.0.1", resolve));
      let authUrl = "";
      const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
        assert.equal(getUrl(input), TOKEN_URL);
        const body = getJsonBody(init);
        assert.equal(body.code, "pasted");
        assert.equal(body.redirect_uri, redirectUri);
        assert.equal(body.state, new URL(authUrl).searchParams.get("state"));
        return tokens();
      });
      vi.stubGlobal("fetch", fetchMock);
      try {
        const credential = await anthropicOAuth.login({
          signal: neverAbortedSignal,
          notify: (event) => {
            if (event.type === "auth_url") authUrl = event.url;
          },
          prompt: async (prompt) => {
            if (prompt.type === "select") return method;
            assert.equal(prompt.type, "manual_code");
            const params = new URL(authUrl).searchParams;
            assert.equal(params.get("redirect_uri"), redirectUri);
            const state = params.get("state");
            assert.ok(state);
            return `pasted#${state}`;
          },
        });
        assert.equal(credential.access, "access");
        assert.equal(fetchMock.mock.calls.length, 1);
      } finally {
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
      }
    },
  );

  test.each(LOGIN_METHODS)("rejects mismatched manual state for $method", async ({ method }) => {
    const codes = stubTokenExchange(tokens);
    await assert.rejects(
      startLogin(async () => "code=manual-code&state=other", neverAbortedSignal, method).credential,
      { message: "OAuth state mismatch" },
    );
    assert.deepEqual(codes, []);
  });

  test.each(LOGIN_METHODS)("propagates $method manual prompt failures", async ({ method }) => {
    const codes = stubTokenExchange(tokens);
    await assert.rejects(
      startLogin(
        async () => {
          throw new Error("prompt cancelled");
        },
        neverAbortedSignal,
        method,
      ).credential,
      { message: "prompt cancelled" },
    );
    assert.deepEqual(codes, []);
  });
});
