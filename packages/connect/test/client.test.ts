import { afterEach, describe, expect, it, vi } from "vitest";
import { BrokerError, REQUEST_TIMEOUT_MS, createBrokerClient } from "../src/index.ts";

const origin = "https://connect.example.com";
const environmentId = "3f0c2a4e-8d2b-4c1a-9e3f-1a2b3c4d5e6f";
const deviceId = "7a0c2a4e-8d2b-4c1a-9e3f-1a2b3c4d5e6f";
const request = { clientId: "client-0123456789ab", clientName: "Phone", digest: "A".repeat(43) };

function client(answer: () => Response, token: string | null = "jwt") {
  const seen: { url: string; authorization: string | null }[] = [];

  return {
    seen,
    broker: createBrokerClient({
      origin,
      sessionToken: () => Promise.resolve(token),
      fetch: (input, init) => {
        seen.push({
          url: input instanceof Request ? input.url : input.toString(),
          authorization: new Headers(init?.headers).get("authorization"),
        });

        return Promise.resolve(answer());
      },
    }),
  };
}

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (cause) {
    if (cause instanceof BrokerError) return cause.failure;
  }

  return undefined;
};

describe("broker client", () => {
  it.each([
    "http://connect.example.com",
    "https://connect.example.com/",
    "https://connect.example.com/v1",
    "https://user:pass@connect.example.com",
    "https://connect.example.com?x=1",
    "https://connect.example.com#x",
  ])("refuses origin %s before asking for a token", (bad) => {
    let asked = false;

    expect(() =>
      createBrokerClient({
        origin: bad,
        sessionToken: () => {
          asked = true;

          return Promise.resolve("jwt");
        },
      }),
    ).toThrow();
    expect(asked).toBe(false);
  });

  it("refuses an answer past the size limit", async () => {
    const { broker } = client(() => new Response("x".repeat(70_000), { status: 200 }));

    expect(await failure(broker.listEnvironments({}))).toEqual({
      kind: "bad_response",
      status: 200,
    });
  });

  it("sends the session token and returns a checked enrollment", async () => {
    const { broker, seen } = client(() =>
      Response.json({ environmentId, deviceId }, { status: 201 }),
    );

    await expect(broker.enroll({ environmentId, request })).resolves.toMatchObject({ deviceId });
    expect(seen).toEqual([
      { url: `${origin}/v1/environments/${environmentId}/devices`, authorization: "Bearer jwt" },
    ]);
  });

  it("refuses an enrollment for another environment", async () => {
    const { broker } = client(() =>
      Response.json({ environmentId: deviceId, deviceId }, { status: 201 }),
    );

    expect(await failure(broker.enroll({ environmentId, request }))).toEqual({
      kind: "bad_response",
      status: 201,
    });
  });

  it("reports signed out without calling the broker", async () => {
    const { broker, seen } = client(() => Response.json({}), null);

    expect(await failure(broker.listEnvironments({}))).toEqual({ kind: "signed_out" });
    expect(seen).toEqual([]);
  });

  it("surfaces contract error codes", async () => {
    const { broker } = client(() =>
      Response.json(
        { error: { code: "session_revoked", message: "Sign in again." } },
        { status: 403 },
      ),
    );

    expect(await failure(broker.revokeDevice({ environmentId, deviceId }))).toEqual({
      kind: "refused",
      status: 403,
      code: "session_revoked",
    });
  });

  it("refuses ids that are not UUIDs before building a path", async () => {
    const { broker, seen } = client(() => new Response(null, { status: 204 }));

    expect(await failure(broker.removeEnvironment({ environmentId: "../x" }))).toMatchObject({
      code: "invalid",
    });
    expect(seen).toEqual([]);
  });
});

describe("a session token that is slow to come", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function pendingToken() {
    let resolve: (token: string | null) => void = () => undefined;
    let calls = 0;
    const token = new Promise<string | null>((settle) => {
      resolve = settle;
    });
    const requests: string[] = [];
    const broker = createBrokerClient({
      origin,
      sessionToken: () => {
        calls += 1;

        return token;
      },
      fetch: (input) => {
        requests.push(input instanceof Request ? input.url : input.toString());

        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });

    return { broker, requests, resolve, calls: () => calls };
  }

  it("rejects as soon as the caller aborts, and never sends the token that comes later", async () => {
    const { broker, requests, resolve } = pendingToken();
    const controller = new AbortController();
    const pending = failure(
      broker.revokeDevice({ environmentId, deviceId, signal: controller.signal }),
    );

    controller.abort();
    expect(await pending).toEqual({ kind: "network" });
    resolve("late-jwt");
    await new Promise((settle) => setTimeout(settle, 10));
    expect(requests).toEqual([]);
  });

  it("does not ask for a token once the caller has aborted", async () => {
    const { broker, requests, calls } = pendingToken();
    const controller = new AbortController();

    controller.abort();
    expect(await failure(broker.listEnvironments({ signal: controller.signal }))).toEqual({
      kind: "network",
    });
    expect(calls()).toBe(0);
    expect(requests).toEqual([]);
  });

  it("gives up at the request timeout when the token never comes", async () => {
    vi.useFakeTimers();
    const { broker, requests, resolve } = pendingToken();
    const pending = failure(broker.removeEnvironment({ environmentId }));

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await pending).toEqual({ kind: "network" });
    resolve("late-jwt");
    await vi.advanceTimersByTimeAsync(10);
    expect(requests).toEqual([]);
  });

  it("reports a failed token lookup without calling the broker", async () => {
    const requests: string[] = [];
    const broker = createBrokerClient({
      origin,
      sessionToken: () => Promise.reject(new Error("Clerk is down")),
      fetch: (input) => {
        requests.push(input instanceof Request ? input.url : input.toString());

        return Promise.resolve(Response.json({ environments: [] }));
      },
    });

    expect(await failure(broker.listEnvironments({}))).toEqual({ kind: "network" });
    expect(requests).toEqual([]);
  });
});
