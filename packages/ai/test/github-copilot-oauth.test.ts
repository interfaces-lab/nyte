import assert from "node:assert/strict";
import { afterEach, describe, test, vi } from "vitest";
import { githubCopilotOAuth } from "@nyte-ai/ai/auth/oauth/github-copilot";
import type { OAuthCredential } from "../src/auth/types.ts";
import {
  DEVICE,
  TOKEN,
  EXCHANGE,
  MODELS,
  SESSION_TOKEN,
  ORIGIN,
  sessionToken,
  deviceCode,
  fakeFetch,
  interaction,
  json,
} from "./github-copilot-fixture.ts";

function outcome(login: Promise<unknown>): Promise<string> {
  return login.then(
    () => "resolved",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

describe("GitHub Copilot device sign-in", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test.each([
    { environment: "", explicit: undefined, expected: "Iv1.b507a08c87ecfe98" },
    { environment: "host-client", explicit: undefined, expected: "host-client" },
    { environment: "host-client", explicit: "explicit-client", expected: "explicit-client" },
  ])("device requests use the selected OAuth client: $expected", async (input) => {
    vi.stubEnv("NYTE_GITHUB_COPILOT_CLIENT_ID", input.environment);
    const controller = new AbortController();
    const transport = fakeFetch({
      [DEVICE]: () => {
        controller.abort();
        return deviceCode();
      },
    });
    await assert.rejects(
      githubCopilotOAuth({ fetch: transport.fetch, clientId: input.explicit }).login(
        interaction(controller.signal),
      ),
      /Login cancelled/,
    );
    assert.equal(new URLSearchParams(transport.requests[0]?.body).get("client_id"), input.expected);
  });

  test("walks the device grant, honours slow_down, and exchanges distinct GitHub and Copilot tokens", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    let polls = 0;
    const transport = fakeFetch({
      [DEVICE]: () => deviceCode(),
      [TOKEN]: () => {
        polls += 1;
        if (polls === 1) return json({ error: "authorization_pending" });
        if (polls === 2) return json({ error: "slow_down", interval: 2 });
        return json({ access_token: "gh-token", token_type: "bearer", scope: "read:user" });
      },
      [EXCHANGE]: () => sessionToken(),
      [MODELS]: () => json({ data: [{ id: "gpt-4.1", model_picker_enabled: true }] }),
    });
    const oauth = githubCopilotOAuth({ fetch: transport.fetch, clientId: "client-under-test" });
    const ui = interaction();
    const login = oauth.login(ui);
    await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(ui.events, [
      {
        type: "device_code",
        userCode: "ABCD-1234",
        verificationUri: "https://github.com/login/device",
        intervalSeconds: 1,
        expiresInSeconds: 900,
      },
    ]);
    // Interval 1s, then GitHub asked for 2s after slow_down.
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(polls, 1);
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(polls, 2);
    await vi.advanceTimersByTimeAsync(1999);
    assert.equal(polls, 2);
    await vi.advanceTimersByTimeAsync(1);
    const credential = await login;

    assert.equal(credential.access, SESSION_TOKEN);
    assert.equal(credential.refresh, "gh-token");
    assert.equal(credential.expires, Math.floor(Date.now() / 1000) * 1000 + 3600_000);
    assert.deepEqual(credential.availableModelIds, ["gpt-4.1"]);
    const auth = await oauth.toAuth(credential);
    assert.equal(auth.apiKey, SESSION_TOKEN);
    assert.equal(auth.baseUrl, ORIGIN);
    assert.equal(auth.headers?.["Copilot-Integration-Id"], "vscode-chat");

    const device = transport.requests[0];
    assert.ok(device);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(device.body)), {
      client_id: "client-under-test",
      scope: "read:user",
    });
    assert.equal(device.headers.get("content-type"), "application/x-www-form-urlencoded");
    const poll = transport.requests[1];
    assert.ok(poll);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(poll.body)), {
      client_id: "client-under-test",
      device_code: "device-1",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    const exchange = transport.requests.find((request) => request.url.endsWith("/v2/token"));
    const catalog = transport.requests.find((request) => request.url.endsWith("/models"));
    assert.equal(exchange?.headers.get("authorization"), "Bearer gh-token");
    assert.equal(catalog?.headers.get("authorization"), `Bearer ${SESSION_TOKEN}`);
    assert.equal(catalog?.headers.get("x-github-api-version"), "2026-06-01");
    assert.equal(catalog?.headers.get("editor-version"), "vscode/1.107.0");
  });

  test("the default device prompt identifies the Copilot app rather than claiming Nyte consent", async () => {
    vi.stubEnv("NYTE_GITHUB_COPILOT_CLIENT_ID", "");
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const transport = fakeFetch({
      [DEVICE]: () => deviceCode(),
      [TOKEN]: () => json({ access_token: "gh-token" }),
      [EXCHANGE]: () => sessionToken(),
      [MODELS]: () => json({ data: [] }),
    });
    const ui = interaction();
    const login = githubCopilotOAuth({ fetch: transport.fetch }).login(ui);
    await vi.advanceTimersByTimeAsync(1000);
    await login;
    const device = transport.requests[0];
    assert.ok(device);
    assert.equal(new URLSearchParams(device.body).get("client_id"), "Iv1.b507a08c87ecfe98");
    const shown = ui.events.find((event) => event.type === "device_code");
    assert.ok(shown);
    assert.match(shown.instructions ?? "", /not a Nyte OAuth app/);
  });

  test("cancelling the login stops polling", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    let polls = 0;
    const transport = fakeFetch({
      [DEVICE]: () => deviceCode(),
      [TOKEN]: () => {
        polls += 1;
        return json({ error: "authorization_pending" });
      },
    });
    const controller = new AbortController();
    const login = githubCopilotOAuth({ fetch: transport.fetch, clientId: "c" }).login(
      interaction(controller.signal),
    );
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(polls, 1);
    controller.abort();
    await assert.rejects(login, /Login cancelled/);
    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(polls, 1);
  });

  test("a cancel during the device code request shows no code to open", async () => {
    const controller = new AbortController();
    const transport = fakeFetch({
      [DEVICE]: () => {
        controller.abort();
        return deviceCode();
      },
    });
    const ui = interaction(controller.signal);
    const login = githubCopilotOAuth({ fetch: transport.fetch, clientId: "c" }).login(ui);
    await assert.rejects(login, /Login cancelled/);
    assert.deepEqual(ui.events, []);
  });

  test("gives up when the device code expires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const transport = fakeFetch({
      [DEVICE]: () => deviceCode({ expires_in: 3 }),
      [TOKEN]: () => json({ error: "authorization_pending" }),
    });
    const login = githubCopilotOAuth({ fetch: transport.fetch, clientId: "c" }).login(
      interaction(),
    );
    const result = outcome(login);
    await vi.advanceTimersByTimeAsync(4000);
    assert.match(await result, /timed out/);
  });

  test("a poll that hangs past the code lifetime is abandoned at the deadline", async () => {
    const transport = fakeFetch({
      [DEVICE]: () => deviceCode({ expires_in: 2, interval: 1 }),
      [TOKEN]: () => new Promise<Response>(() => {}),
    });
    let aborted = false;
    const observing: typeof globalThis.fetch = (input, init) => {
      if (typeof input === "string" && input.endsWith("/access_token"))
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
      return transport.fetch(input, init);
    };
    const started = Date.now();
    const login = githubCopilotOAuth({ fetch: observing, clientId: "c" }).login(interaction());
    const message = await outcome(login);
    assert.match(message, /expired before GitHub approved it/);
    assert.ok(Date.now() - started < 10_000, "must not wait for the request timeout");
    assert.equal(transport.requests.length, 2);
    assert.equal(aborted, true);
  });

  test("cancelling abandons a response body that never arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const controller = new AbortController();
    const transport = fakeFetch({
      [DEVICE]: () =>
        new Response(
          new ReadableStream({
            start() {
              // Never enqueue: headers arrive, the body does not.
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });
    const login = githubCopilotOAuth({ fetch: transport.fetch, clientId: "c" }).login(
      interaction(controller.signal),
    );
    const result = outcome(login);
    controller.abort();
    assert.match(await result, /Login cancelled/);
  });

  test("a denied grant fails without attempting a Copilot exchange", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const transport = fakeFetch({
      [DEVICE]: () => deviceCode(),
      [TOKEN]: () => json({ error: "access_denied" }),
    });
    const login = githubCopilotOAuth({ fetch: transport.fetch, clientId: "c" }).login(
      interaction(),
    );
    const result = outcome(login);
    await vi.advanceTimersByTimeAsync(1000);
    assert.match(await result, /denied/);
    assert.ok(transport.requests.every((request) => !request.url.endsWith("/v2/token")));
  });

  test("error responses never surface GitHub's body or the transport message", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const secret = "ghu_SECRET_TOKEN_VALUE";
    const failing = fakeFetch({
      [DEVICE]: () => new Response(`<html>${secret}</html>`, { status: 503 }),
    });
    const httpFailure = await outcome(
      githubCopilotOAuth({ fetch: failing.fetch, clientId: "c" }).login(interaction()),
    );
    assert.equal(httpFailure, "GitHub device code request failed (HTTP 503)");

    const throwing = fakeFetch({
      [DEVICE]: () => {
        throw new Error(`connect failed for Authorization: Bearer ${secret}`);
      },
    });
    const networkFailure = await outcome(
      githubCopilotOAuth({ fetch: throwing.fetch, clientId: "c" }).login(interaction()),
    );
    assert.equal(networkFailure, "GitHub device code request failed: network error");

    const described = fakeFetch({
      [DEVICE]: () => deviceCode(),
      [TOKEN]: () =>
        json({
          error: "incorrect_client_credentials",
          error_description: `client secret ${secret} was wrong`,
        }),
    });
    const grantFailure = outcome(
      githubCopilotOAuth({ fetch: described.fetch, clientId: "c" }).login(interaction()),
    );
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(
      await grantFailure,
      "GitHub device authorization failed: incorrect_client_credentials",
    );

    const unknown = fakeFetch({
      [DEVICE]: () => deviceCode(),
      [TOKEN]: () => json({ error: `weird ${secret}`, error_description: secret }),
    });
    const unknownFailure = outcome(
      githubCopilotOAuth({ fetch: unknown.fetch, clientId: "c" }).login(interaction()),
    );
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(
      await unknownFailure,
      "GitHub device authorization failed with an unrecognized error",
    );
  });

  test("auth requests refuse redirects", async () => {
    const transport = fakeFetch({ [DEVICE]: () => deviceCode() });
    const seen: (RequestInit["redirect"] | undefined)[] = [];
    const observing: typeof globalThis.fetch = (input, init) => {
      seen.push(init?.redirect);
      return transport.fetch(input, init);
    };
    const controller = new AbortController();
    const login = githubCopilotOAuth({ fetch: observing, clientId: "c" }).login(
      interaction(controller.signal),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await login.catch(() => undefined);
    assert.deepEqual(seen, ["error"]);
  });

  test.each([
    "https://github.com.evil.example/login",
    "http://github.com/login/device",
    "https://github.com:8443/login/device",
    "https://github.com/settings",
    "https://user:pass@github.com/login/device",
    "not a URL",
  ])(
    "refuses an untrusted verification page without presenting it: %s",
    async (verificationUri) => {
      const transport = fakeFetch({
        [DEVICE]: () => deviceCode({ verification_uri: verificationUri }),
      });
      const ui = interaction();
      await assert.rejects(
        githubCopilotOAuth({ fetch: transport.fetch, clientId: "c" }).login(ui),
        /outside github\.com/,
      );
      assert.deepEqual(ui.events, []);
    },
  );

  test("nonsense lifetimes and intervals fall back to bounded defaults", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const transport = fakeFetch({
      [DEVICE]: () => deviceCode({ expires_in: -5, interval: "soon" }),
      [TOKEN]: () => json({ access_token: "gh-token" }),
      [EXCHANGE]: () => sessionToken(),
      [MODELS]: () => json({ data: [] }),
    });
    const ui = interaction();
    const login = githubCopilotOAuth({ fetch: transport.fetch, clientId: "c" }).login(ui);
    await vi.advanceTimersByTimeAsync(0);
    const shown = ui.events.find((event) => event.type === "device_code");
    assert.ok(shown && shown.type === "device_code");
    assert.equal(shown.intervalSeconds, undefined);
    assert.equal(shown.expiresInSeconds, 900);
    await vi.advanceTimersByTimeAsync(5000);
    assert.equal((await login).access, SESSION_TOKEN);
  });

  test("a rejected session exchange fails sign-in rather than saving unverified access", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const transport = fakeFetch({
      [DEVICE]: () => deviceCode(),
      [TOKEN]: () => json({ access_token: "gh-token" }),
      [EXCHANGE]: () => new Response("secret gh-token", { status: 403 }),
    });
    const result = outcome(
      githubCopilotOAuth({ fetch: transport.fetch, clientId: "c" }).login(interaction()),
    );
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(await result, "GitHub Copilot token exchange failed (HTTP 403)");
    assert.ok(transport.requests.every((request) => !request.url.endsWith("/models")));
  });

  test("rejects malformed and already-expired exchanged tokens", async () => {
    for (const response of [
      { token: "", expires_at: 1 },
      { token: SESSION_TOKEN, expires_at: "tomorrow" },
      { token: SESSION_TOKEN, expires_at: 1 },
      { token: SESSION_TOKEN, expires_at: 1e30 },
    ]) {
      const transport = fakeFetch({ [EXCHANGE]: () => json(response) });
      await assert.rejects(
        githubCopilotOAuth({ fetch: transport.fetch }).refresh(
          {
            type: "oauth",
            access: "expired",
            refresh: "gh-token",
            expires: 0,
            availableModelIds: [],
          },
          new AbortController().signal,
        ),
        /invalid token or expiry/,
      );
    }
  });

  test.each([
    { token: "opaque", origin: ORIGIN },
    {
      token: "tid=x;proxy-ep=proxy.business.githubcopilot.com;exp=1",
      origin: "https://api.business.githubcopilot.com",
    },
    { token: "proxy-ep=api.githubcopilot.com:443", origin: "https://api.githubcopilot.com" },
  ])("request auth derives the trusted account endpoint: $origin", async (input) => {
    const oauth = githubCopilotOAuth();
    const auth = await oauth.toAuth({
      type: "oauth",
      access: input.token,
      refresh: "gh-token",
      expires: 0,
      availableModelIds: [],
      apiEndpoint: "https://ignored.example",
    });
    assert.equal(auth.baseUrl, input.origin);
    assert.equal(auth.apiKey, input.token);
  });

  test.each([
    "evil.example",
    "api.githubcopilot.com.attacker.example",
    "api.githubcopilot.com:8443",
    "user:pass@api.githubcopilot.com",
    "api.githubcopilot.com/path",
    "api.githubcopilot.com?x=1",
    "http://api.githubcopilot.com",
  ])("rejects an untrusted token endpoint before sending the session token: %s", async (host) => {
    const transport = fakeFetch({ [EXCHANGE]: () => sessionToken(`proxy-ep=${host}`) });
    const oauth = githubCopilotOAuth({ fetch: transport.fetch });
    await assert.rejects(
      oauth.refresh(
        {
          type: "oauth",
          access: "expired",
          refresh: "gh-token",
          expires: 0,
          availableModelIds: [],
        },
        new AbortController().signal,
      ),
      /untrusted API endpoint/,
    );
    assert.equal(transport.requests.length, 1);
    await assert.rejects(
      oauth.toAuth({
        type: "oauth",
        access: `proxy-ep=${host}`,
        refresh: "gh-token",
        expires: 0,
        availableModelIds: [],
      }),
      /untrusted API endpoint/,
    );
  });

  test("refresh exchanges the GitHub token again and reloads account availability without device sign-in", async () => {
    const transport = fakeFetch({
      [EXCHANGE]: () => sessionToken("tid=new;proxy-ep=proxy.business.githubcopilot.com"),
      ["GET https://api.business.githubcopilot.com/models"]: () =>
        json({ data: [{ id: "gpt-4.1", model_picker_enabled: true }] }),
    });
    const oauth = githubCopilotOAuth({ fetch: transport.fetch });
    const refreshed = await oauth.refresh(
      {
        type: "oauth",
        access: "expired-session",
        refresh: "gh-token",
        expires: 0,
        availableModelIds: ["removed-model"],
      },
      new AbortController().signal,
    );
    assert.equal(refreshed.refresh, "gh-token");
    assert.equal(refreshed.access, "tid=new;proxy-ep=proxy.business.githubcopilot.com");
    assert.deepEqual(refreshed.availableModelIds, ["gpt-4.1"]);
    assert.equal((await oauth.toAuth(refreshed)).baseUrl, "https://api.business.githubcopilot.com");
    assert.equal(transport.requests.length, 2);
    assert.equal(transport.requests[0]?.headers.get("authorization"), "Bearer gh-token");
    assert.equal(transport.requests[1]?.headers.get("authorization"), `Bearer ${refreshed.access}`);
  });

  test("account models needing approval never trigger silent policy changes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const transport = fakeFetch({
      [DEVICE]: () => deviceCode(),
      [TOKEN]: () => json({ access_token: "gh-token" }),
      [EXCHANGE]: () => sessionToken(),
      [MODELS]: () =>
        json({
          data: [
            {
              id: "claude-sonnet-4.6",
              model_picker_enabled: true,
              policy: { state: "unconfigured" },
            },
          ],
        }),
    });
    const ui = interaction();
    const login = githubCopilotOAuth(
      { fetch: transport.fetch, clientId: "c" },
      () => new Set(["claude-sonnet-4.6"]),
    ).login(ui);
    await vi.advanceTimersByTimeAsync(1000);
    assert.deepEqual((await login).availableModelIds, []);
    assert.ok(
      ui.events.some(
        (event) => event.type === "info" && event.message.includes("account approval"),
      ),
    );
    assert.ok(transport.requests.every((request) => !request.url.endsWith("/policy")));
  });

  test.each([
    { access: "", refresh: "github", expires: 0, availableModelIds: [] },
    { access: "session", refresh: "", expires: 0, availableModelIds: [] },
    {
      access: "session",
      refresh: "github",
      expires: Number.POSITIVE_INFINITY,
      availableModelIds: [],
    },
    { access: "session", refresh: "github", expires: 0, availableModelIds: undefined },
    { access: "session", refresh: "github", expires: 0, availableModelIds: [42] },
  ])("rejects incomplete stored credentials before refresh or request auth: %j", async (fields) => {
    const transport = fakeFetch({});
    const oauth = githubCopilotOAuth({ fetch: transport.fetch });
    const credential: OAuthCredential = { type: "oauth", ...fields };
    await assert.rejects(
      oauth.refresh(credential, new AbortController().signal),
      /Sign in to GitHub Copilot again/,
    );
    await assert.rejects(oauth.toAuth(credential), /Sign in to GitHub Copilot again/);
    assert.equal(transport.requests.length, 0);
  });
});
