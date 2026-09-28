import assert from "node:assert/strict";
import { createNyteClient } from "@nyte-ai/client";
import { CALL_ROUTE_PREFIX } from "@nyte-ai/protocol";
import type { LoginAttempt } from "@nyte-ai/protocol";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { HostEvent, LoginProgress } from "../bridge.ts";
import { createEnvironmentSignIn, webPageUrl } from "./sign-in.ts";

interface Call {
  readonly operation: string;
  readonly input: unknown;
}

/** A server whose `environment.login` answers `started` and whose polls answer `polls` in order. */
function serve({ started, polls }: { started: LoginAttempt; polls: readonly LoginAttempt[] }) {
  const calls: Call[] = [];
  const events: HostEvent[] = [];
  const pending = [...polls];

  const reply = (operation: string): unknown => {
    if (operation === "environment.login") return started;

    if (operation === "environment.loginAttempt") return pending.shift() ?? { kind: "unknown" };

    return undefined;
  };

  const client = createNyteClient({
    baseUrl: "https://server.test",
    fetch: async (url, init) => {
      const request = new Request(url, init);
      const operation = request.url.slice(`https://server.test${CALL_ROUTE_PREFIX}`.length);
      const body: unknown = await request.json();
      calls.push({
        operation,
        input:
          typeof body === "object" && body !== null && "input" in body ? body.input : undefined,
      });
      const value = reply(operation);

      return Response.json(
        value === undefined ? { ok: true, defined: false } : { ok: true, defined: true, value },
      );
    },
  });

  const signIn = createEnvironmentSignIn({
    environment: (operation, input) => client.environment(operation, input),
    emit: (event) => events.push(event),
  });

  return { signIn, calls, events };
}

const deviceCode = { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("a device-code sign-in reports each new state once and refreshes the catalog when it connects", async () => {
  const { signIn, calls, events } = serve({
    started: { kind: "running", deviceCode },
    polls: [
      { kind: "running", deviceCode },
      { kind: "running", deviceCode, message: "Waiting for approval" },
      { kind: "settled", outcome: { kind: "connected", catalogRefreshed: true } },
    ],
  });

  const outcome = signIn.login({ provider: "copilot", method: { kind: "browser" }, attempt: "a1" });
  await vi.runAllTimersAsync();

  assert.deepEqual(await outcome, { kind: "connected", catalogRefreshed: true });
  assert.deepEqual(
    calls.map((call) => call.operation),
    [
      "environment.login",
      "environment.loginAttempt",
      "environment.loginAttempt",
      "environment.loginAttempt",
    ],
  );
  assert.deepEqual(calls[1]?.input, { attempt: "a1" });

  const code: LoginProgress = {
    kind: "device_code",
    ...deviceCode,
    expiresInSeconds: undefined,
    instructions: undefined,
  };

  const progress = (item: LoginProgress): HostEvent => ({
    kind: "login_progress",
    attempt: "a1",
    provider: "copilot",
    progress: item,
  });

  assert.deepEqual(events, [
    progress(code),
    progress(code),
    progress({ kind: "message", message: "Waiting for approval" }),
    { kind: "catalog_changed" },
  ]);
});

test("a browser sign-in shows its page and forwards a pasted code to the same attempt", async () => {
  const { signIn, calls, events } = serve({
    started: {
      kind: "running",
      browser: { url: "https://claude.ai/oauth/authorize?state=x", acceptsCode: true },
    },
    polls: [{ kind: "settled", outcome: { kind: "connected", catalogRefreshed: false } }],
  });

  const outcome = signIn.login({
    provider: "anthropic",
    method: { kind: "browser" },
    attempt: "b",
  });
  await signIn.answerLogin({ attempt: "b", code: "http://localhost:1455/callback?code=secret" });
  await vi.runAllTimersAsync();

  assert.deepEqual(await outcome, { kind: "connected", catalogRefreshed: false });
  assert.deepEqual(events, [
    {
      kind: "login_progress",
      attempt: "b",
      provider: "anthropic",
      progress: {
        kind: "browser",
        url: "https://claude.ai/oauth/authorize?state=x",
        instructions: undefined,
        acceptsCode: true,
      },
    },
    { kind: "catalog_changed" },
  ]);
  assert.deepEqual(calls.find((call) => call.operation === "environment.answerLogin")?.input, {
    attempt: "b",
    code: "http://localhost:1455/callback?code=secret",
  });
});

test("a sign-in link that is not a web page is never shown and the attempt is cancelled", async () => {
  const { signIn, calls, events } = serve({
    started: { kind: "running", browser: { url: "javascript:alert(1)", acceptsCode: false } },
    polls: [],
  });

  await assert.rejects(
    signIn.login({ provider: "anthropic", method: { kind: "browser" }, attempt: "c" }),
  );
  assert.deepEqual(events, []);
  assert.deepEqual(calls.at(-1), {
    operation: "environment.cancelLogin",
    input: { attempt: "c" },
  });
});

test("a failed attempt rejects without refreshing the catalog", async () => {
  const { signIn, events } = serve({
    started: { kind: "running", message: "Checking the key" },
    polls: [{ kind: "failed" }],
  });

  const outcome = signIn.login({
    provider: "openai",
    method: { kind: "api_key", key: "sk-test" },
    attempt: "d",
  });
  const rejected = assert.rejects(outcome);
  await vi.runAllTimersAsync();
  await rejected;

  assert.equal(
    events.some((event) => event.kind === "catalog_changed"),
    false,
  );
});

test("only http and https addresses count as web pages", () => {
  assert.equal(webPageUrl("https://github.com/login/device"), "https://github.com/login/device");
  assert.equal(webPageUrl("http://localhost:1455/auth"), "http://localhost:1455/auth");
  assert.equal(webPageUrl("javascript:alert(1)"), undefined);
  assert.equal(webPageUrl("file:///etc/passwd"), undefined);
  assert.equal(webPageUrl("not a url"), undefined);
});
