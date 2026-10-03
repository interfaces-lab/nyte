/**
 * Based on https://github.com/earendil-works/pi/blob/main/packages/ai/test/openai-codex-oauth.test.ts
 * Synced with pi a276dabe5.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, describe, vi, test } from "vitest";
import { openaiCodexOAuth } from "../src/auth/oauth/openai-codex.ts";

const neverAbortedSignal = new AbortController().signal;

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  throw new Error(`Unsupported fetch input: ${String(input)}`);
}

function createAccessToken(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64");
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
      },
    }),
  ).toString("base64");
  return `${header}.${payload}.signature`;
}

function deviceAuthPendingResponse(): Response {
  return jsonResponse(
    {
      error: {
        message: "Device authorization is pending. Please try again.",
        type: "invalid_request_error",
        param: null,
        code: "deviceauth_authorization_pending",
      },
    },
    403,
  );
}

type DeviceInfo = {
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
};

function loginOpenAICodexDeviceCodeForTest(options: {
  onDeviceCode(info: DeviceInfo): void;
  onMethodIds?(ids: string[]): void;
  signal?: AbortSignal;
}) {
  return openaiCodexOAuth.login({
    signal: options.signal ?? neverAbortedSignal,
    prompt: async (prompt) => {
      if (prompt.type !== "select") throw new Error(`Unexpected prompt: ${prompt.type}`);
      options.onMethodIds?.(prompt.options.map((option) => option.id));
      return "device_code";
    },
    notify: (event) => {
      if (event.type === "device_code") {
        const { type: _, ...info } = event;
        options.onDeviceCode(info);
      }
    },
  });
}

function stubFetch(impl: (input: unknown, init?: RequestInit) => Promise<Response>): void {
  vi.stubGlobal("fetch", vi.fn(impl));
}

function bodyText(init?: RequestInit): string {
  const body = init?.body;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error(`Expected string or URLSearchParams body, got ${typeof body}`);
}

function headerValue(
  headers: ConstructorParameters<typeof Headers>[0] | undefined,
  name: string,
): string | undefined {
  return new Headers(headers).get(name) ?? undefined;
}

describe("OpenAI Codex OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("logs in with the OpenAI Codex device code flow", async () => {
    const startTime = new Date("2026-05-20T00:00:00Z").getTime();
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"], now: startTime });

    const accessToken = createAccessToken("account-123");
    const deviceInfos: DeviceInfo[] = [];
    const methodIds: string[][] = [];
    const pollTimes: number[] = [];
    const pollResponses = [
      deviceAuthPendingResponse(),
      jsonResponse({
        authorization_code: "oauth-code",
        code_challenge: "device-code-challenge",
        code_verifier: "device-code-verifier",
      }),
    ];

    stubFetch(async (input, init) => {
      const url = getUrl(input);

      if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
        assert.equal(init?.method, "POST");
        assert.equal(headerValue(init?.headers, "Content-Type"), "application/json");
        assert.deepEqual(JSON.parse(bodyText(init)), {
          client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        });
        return jsonResponse({
          device_auth_id: "device-auth-id",
          user_code: "ABCD-1234",
          interval: "5",
        });
      }

      if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
        pollTimes.push(Date.now());
        assert.equal(init?.method, "POST");
        assert.equal(headerValue(init?.headers, "Content-Type"), "application/json");
        assert.deepEqual(JSON.parse(bodyText(init)), {
          device_auth_id: "device-auth-id",
          user_code: "ABCD-1234",
        });
        const response = pollResponses.shift();
        if (!response) {
          throw new Error("Unexpected extra device auth poll");
        }
        return response;
      }

      if (url === "https://auth.openai.com/oauth/token") {
        assert.equal(init?.method, "POST");
        assert.equal(
          headerValue(init?.headers, "Content-Type"),
          "application/x-www-form-urlencoded",
        );
        const params = new URLSearchParams(bodyText(init));
        assert.equal(params.get("grant_type"), "authorization_code");
        assert.equal(params.get("client_id"), "app_EMoamEEZ73f0CkXaXp7hrann");
        assert.equal(params.get("code"), "oauth-code");
        assert.equal(params.get("redirect_uri"), "https://auth.openai.com/deviceauth/callback");
        assert.equal(params.get("code_verifier"), "device-code-verifier");
        return jsonResponse({
          access_token: accessToken,
          refresh_token: "refresh-token",
          expires_in: 3600,
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const credentialsPromise = loginOpenAICodexDeviceCodeForTest({
      onDeviceCode: (info) => deviceInfos.push(info),
      onMethodIds: (ids) => methodIds.push(ids),
    });

    for (let i = 0; i < 5 && pollTimes.length === 0; i++) {
      await vi.advanceTimersByTimeAsync(0);
    }
    assert.deepEqual(methodIds, [["browser", "device_code"]]);
    assert.deepEqual(deviceInfos, [
      {
        userCode: "ABCD-1234",
        verificationUri: "https://auth.openai.com/codex/device",
        intervalSeconds: 5,
        expiresInSeconds: 900,
      },
    ]);
    assert.deepEqual(pollTimes, [startTime]);

    await vi.advanceTimersByTimeAsync(4999);
    assert.deepEqual(pollTimes, [startTime]);

    await vi.advanceTimersByTimeAsync(1);
    const credentials = await credentialsPromise;
    assert.equal(credentials.access, accessToken);
    assert.equal(credentials.refresh, "refresh-token");
    assert.equal(credentials.expires, startTime + 5000 + 3600 * 1000);
    assert.equal(credentials["accountId"], "account-123");
    assert.deepEqual(pollTimes, [startTime, startTime + 5000]);
  });

  test("cancels the OpenAI Codex device code flow while waiting", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const controller = new AbortController();
    const pollTimes: number[] = [];

    stubFetch(async (input, init) => {
      const url = getUrl(input);
      if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
        assert.deepEqual(JSON.parse(bodyText(init)), {
          client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        });
        return jsonResponse({
          device_auth_id: "device-auth-id",
          user_code: "ABCD-1234",
          interval: "5",
        });
      }
      if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
        pollTimes.push(Date.now());
        return deviceAuthPendingResponse();
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const credentialsPromise = loginOpenAICodexDeviceCodeForTest({
      onDeviceCode: () => {},
      signal: controller.signal,
    });
    const rejectionPromise = credentialsPromise.then(
      () => new Error("Expected login to fail"),
      (error: unknown) => error,
    );

    for (let i = 0; i < 5 && pollTimes.length === 0; i++) {
      await vi.advanceTimersByTimeAsync(0);
    }
    assert.equal(pollTimes.length, 1);

    controller.abort();
    const rejection = await rejectionPromise;
    assert.ok(rejection instanceof Error);
    assert.equal(rejection.message, "Login cancelled");
  });

  test("times out the OpenAI Codex device code flow after 15 minutes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const pollTimes: number[] = [];

    stubFetch(async (input, init) => {
      const url = getUrl(input);
      if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
        assert.deepEqual(JSON.parse(bodyText(init)), {
          client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        });
        return jsonResponse({
          device_auth_id: "device-auth-id",
          user_code: "ABCD-1234",
          interval: "60",
        });
      }
      if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
        pollTimes.push(Date.now());
        return deviceAuthPendingResponse();
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const credentialsPromise = loginOpenAICodexDeviceCodeForTest({
      onDeviceCode: () => {},
    });
    const rejectionPromise = credentialsPromise.then(
      () => new Error("Expected login to fail"),
      (error: unknown) => error,
    );

    for (let i = 0; i < 5 && pollTimes.length === 0; i++) {
      await vi.advanceTimersByTimeAsync(0);
    }
    assert.equal(pollTimes.length, 1);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    const rejection = await rejectionPromise;
    assert.ok(rejection instanceof Error);
    assert.equal(rejection.message, "Device flow timed out");
  });

  test("treats OpenAI Codex device auth 403 and 404 responses as pending", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const accessToken = createAccessToken("account-403-404");
    const pollTimes: number[] = [];
    const pollResponses = [
      jsonResponse({ error: "access_denied", error_description: "denied" }, 403),
      new Response("not ready", { status: 404, headers: { "Content-Type": "text/plain" } }),
      jsonResponse({
        authorization_code: "oauth-code",
        code_challenge: "device-code-challenge",
        code_verifier: "device-code-verifier",
      }),
    ];

    stubFetch(async (input) => {
      const url = getUrl(input);
      if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
        return jsonResponse({
          device_auth_id: "device-auth-id",
          user_code: "ABCD-1234",
          interval: "1",
        });
      }
      if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
        pollTimes.push(Date.now());
        const response = pollResponses.shift();
        if (!response) {
          throw new Error("Unexpected extra device auth poll");
        }
        return response;
      }
      if (url === "https://auth.openai.com/oauth/token") {
        return jsonResponse({
          access_token: accessToken,
          refresh_token: "refresh-token",
          expires_in: 3600,
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const credentialsPromise = loginOpenAICodexDeviceCodeForTest({
      onDeviceCode: () => {},
    });

    for (let i = 0; i < 5 && pollTimes.length === 0; i++) {
      await vi.advanceTimersByTimeAsync(0);
    }
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const credentials = await credentialsPromise;
    assert.equal(credentials.access, accessToken);
    assert.equal(credentials.refresh, "refresh-token");
    assert.equal(credentials["accountId"], "account-403-404");
    assert.equal(pollTimes.length, 3);
  });

  test("includes the response body in OpenAI Codex device auth poll failures", async () => {
    stubFetch(async (input) => {
      const url = getUrl(input);
      if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
        return jsonResponse({
          device_auth_id: "device-auth-id",
          user_code: "ABCD-1234",
          interval: "5",
        });
      }
      if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
        return jsonResponse({ error: "server_error", error_description: "try again later" }, 500);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await assert.rejects(
      loginOpenAICodexDeviceCodeForTest({
        onDeviceCode: () => {},
      }),
      {
        message:
          'OpenAI Codex device auth failed with status 500: {"error":"server_error","error_description":"try again later"}',
      },
    );
  });

  test("does not write token refresh failures to stderr", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: "Could not validate your token. Please try signing in again.",
            type: "invalid_request_error",
          },
        }),
        {
          status: 401,
          statusText: "Unauthorized",
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    await assert.rejects(
      openaiCodexOAuth.refresh(
        {
          type: "oauth",
          access: "invalid-access-token",
          refresh: "invalid-refresh-token",
          expires: 0,
        },
        neverAbortedSignal,
      ),
      /OpenAI Codex token refresh failed \(401\).*Could not validate your token/,
    );
    assert.equal(consoleError.mock.calls.length, 0);
  });

  test("falls back to the pasted redirect URL when the fixed callback port is taken", async () => {
    // Port 1455 is registered with OpenAI; the Codex CLI may hold it. Occupy it unless it already is.
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.once("error", () => resolve());
      blocker.listen(1455, "127.0.0.1", () => resolve());
    });
    try {
      let exchangeBody: URLSearchParams | undefined;
      stubFetch(async (input, init) => {
        assert.equal(getUrl(input), "https://auth.openai.com/oauth/token");
        exchangeBody = new URLSearchParams(bodyText(init));
        return jsonResponse({
          access_token: createAccessToken("acct"),
          refresh_token: "refresh",
          expires_in: 3600,
        });
      });

      let authUrl = "";
      const credential = await openaiCodexOAuth.login({
        signal: neverAbortedSignal,
        notify: (event) => {
          if (event.type === "auth_url") authUrl = event.url;
        },
        prompt: async (prompt) => {
          if (prompt.type === "select") return "browser";
          if (prompt.type !== "manual_code") throw new Error(`Unexpected prompt: ${prompt.type}`);
          const state = new URL(authUrl).searchParams.get("state");
          return `http://localhost:1455/auth/callback?code=pasted-code&state=${state}`;
        },
      });

      assert.equal(credential["accountId"], "acct");
      assert.equal(exchangeBody?.get("code"), "pasted-code");
      assert.equal(exchangeBody?.get("redirect_uri"), "http://localhost:1455/auth/callback");
    } finally {
      blocker.close();
    }
  });
});
