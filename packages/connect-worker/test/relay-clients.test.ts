/** Browser and phone requests through the relay: CORS, enrollment, forwarding, refusals, and the channel limit. See `relay-fixture.ts`. */
import { BROKER_ROUTES, EnvironmentList } from "@nyte-ai/connect";
import {
  RELAY_BODY_LIMIT_BYTES,
  RELAY_CHANNEL_LIMIT,
  RELAY_REQUEST_HEADER_NAMES,
} from "@nyte-ai/connect/relay";
import { Value } from "typebox/value";

import { describe, expect, it } from "vitest";
import {
  deviceToken,
  echo,
  enrolled,
  phone,
  wireError,
  refused,
  waitFor,
  WEB_ORIGINS,
  RELAY_EXPOSED,
  expectCors,
  broker,
  withWorkerdRelay,
  abortBeforeHeadKeepsSocket,
  answerUntilReset,
} from "./relay-fixture.ts";

withWorkerdRelay();

describe("browser clients", () => {
  it.each(WEB_ORIGINS)(
    "preflights only client routes for %s without authentication",
    async (origin) => {
      const environmentId = crypto.randomUUID();
      const deviceId = crypto.randomUUID();

      const brokerHeaders = {
        requested: "Authorization, Content-Type",
        allowed: "authorization, content-type",
      };

      const relayHeaders = {
        requested: "Authorization, Content-Type, X-Nyte-Input",
        allowed: RELAY_REQUEST_HEADER_NAMES.join(", "),
      };

      const routes = [
        [BROKER_ROUTES.environments, "GET", "GET", brokerHeaders],
        [BROKER_ROUTES.environment(environmentId), "DELETE", "DELETE", brokerHeaders],
        [BROKER_ROUTES.devices(environmentId), "POST", "POST", brokerHeaders],
        [BROKER_ROUTES.device(environmentId, deviceId), "DELETE", "DELETE", brokerHeaders],
        [`/r/${environmentId}/head.watch`, "POST", "POST", relayHeaders],
        [`/r/${environmentId}/.nyte/describe`, "GET", "GET", relayHeaders],
        [`/r/${environmentId}/_nyte/connect/device`, "DELETE", "DELETE", relayHeaders],
      ] as const;

      for (const [path, method, methods, headers] of routes) {
        const answer = await broker.fetch(`${broker.origin}${path}`, {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": method,
            "access-control-request-headers": headers.requested,
          },
        });

        expect(answer.status).toBe(204);
        expect(await answer.text()).toBe("");
        expectCors(answer, origin, headers === relayHeaders ? RELAY_EXPOSED : undefined);
        expect(answer.headers.get("access-control-allow-methods")).toBe(methods);
        expect(answer.headers.get("access-control-allow-headers")).toBe(headers.allowed);
        expect(answer.headers.get("access-control-max-age")).toBe("600");
      }
    },
  );

  it("lists, enrolls, and relays HTTP, SSE and self-release for a browser origin", async () => {
    const origin = "https://app.nyte.sh";
    const seen: unknown[] = [];
    const input = await enrolled(
      async (request) => {
        seen.push({ method: request.method, path: request.path, headers: request.headers });

        return request.method === "DELETE"
          ? { status: 204 }
          : {
              status: 200,
              headers: { "content-type": "text/event-stream" },
              body: "data: hello\n\n",
            };
      },
      "user_alice",
      origin,
    );
    const list = await broker.fetch(`${broker.origin}${BROKER_ROUTES.environments}`, {
      headers: {
        origin,
        authorization: `Bearer ${await broker.sessionToken({ userId: "user_alice", claims: { azp: origin } })}`,
      },
    });

    expect(list.status).toBe(200);
    expectCors(list, origin);
    const body: unknown = await list.json();
    expect(Value.Check(EnvironmentList, body)).toBe(true);

    for (const [method, path] of [
      ["POST", "/head.watch"],
      ["GET", "/.nyte/describe"],
    ] as const) {
      const answer = await phone(input, path, {
        method,
        headers: {
          origin,
          accept: "text/event-stream",
          cookie: "secret=discard",
          referer: `${origin}/workspace`,
          "sec-fetch-site": "cross-site",
          "x-forwarded-host": "evil.example",
        },
      });

      expect(answer.status).toBe(200);
      expectCors(answer, origin, RELAY_EXPOSED);
      expect(answer.headers.get("content-type")).toBe("text/event-stream");
      expect(await answer.text()).toBe("data: hello\n\n");
      expect(seen.pop()).toEqual({
        method,
        path,
        headers: { authorization: `Bearer ${input.bearer}`, accept: "text/event-stream" },
      });
    }

    const release = await phone(input, "/_nyte/connect/device", {
      method: "DELETE",
      headers: { origin, accept: "application/json" },
    });
    expect(release.status).toBe(204);
    expectCors(release, origin, RELAY_EXPOSED);
    expect(seen.pop()).toEqual({
      method: "DELETE",
      path: "/_nyte/connect/device",
      headers: { authorization: `Bearer ${input.bearer}`, accept: "application/json" },
    });

    const revoked = await broker.fetch(
      `${broker.origin}${BROKER_ROUTES.device(input.environmentId, input.deviceId)}`,
      {
        method: "DELETE",
        headers: {
          origin,
          authorization: `Bearer ${await broker.sessionToken({ userId: "user_alice" })}`,
        },
      },
    );
    expect(revoked.status).toBe(204);
    expectCors(revoked, origin);
    const removed = await broker.fetch(
      `${broker.origin}${BROKER_ROUTES.environment(input.environmentId)}`,
      {
        method: "DELETE",
        headers: {
          origin,
          authorization: `Bearer ${await broker.sessionToken({ userId: "user_alice" })}`,
        },
      },
    );
    expect(removed.status).toBe(204);
    expectCors(removed, origin);
  });

  it("makes auth and offline errors readable but refuses unlisted origins before forwarding", async () => {
    const origin = "https://app.nyte.sh";
    const input = await enrolled();
    input.desktop.handler = undefined;
    const missing = await phone({ environmentId: input.environmentId }, "/sessions.list", {
      headers: { origin },
    });
    expectCors(missing, origin, RELAY_EXPOSED);
    expect(await wireError(missing)).toEqual(refused(401, "unauthorized"));
    const invalidSession = await broker.fetch(`${broker.origin}${BROKER_ROUTES.environments}`, {
      headers: { origin },
    });
    expect(invalidSession.status).toBe(401);
    expectCors(invalidSession, origin);
    await invalidSession.body?.cancel();

    for (const unlisted of [
      "https://evil.example",
      "null",
      "https://app.nyte.sh/",
      "http://localhost:5180",
    ]) {
      const denied = await phone(input, "/sessions.list", { headers: { origin: unlisted } });
      expect(await wireError(denied)).toEqual(refused(403, "forbidden"));
      expect(denied.headers.get("access-control-allow-origin")).toBeNull();
      const preflight = await broker.fetch(`${broker.origin}${BROKER_ROUTES.environments}`, {
        method: "OPTIONS",
        headers: { origin: unlisted, "access-control-request-method": "GET" },
      });
      expect(preflight.status).toBe(403);
      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
      await preflight.body?.cancel();
    }
    expect(input.desktop.pending("open")).toEqual([]);
    input.desktop.close();
    const offline = await phone(input, "/sessions.list", { headers: { origin } });
    expectCors(offline, origin, RELAY_EXPOSED);
    expect(await wireError(offline)).toEqual(refused(503, "closed"));
  });

  it("keeps desktop operations and machine-key authentication outside CORS", async () => {
    const origin = "https://app.nyte.sh";
    const environmentId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const routes = [
      [BROKER_ROUTES.environments, "POST"],
      [BROKER_ROUTES.lease(environmentId), "POST"],
      [BROKER_ROUTES.relay(environmentId), "GET"],
      [BROKER_ROUTES.release(environmentId, deviceId), "POST"],
      [BROKER_ROUTES.keys, "GET"],
      [BROKER_ROUTES.webhook, "POST"],
    ];

    for (const [path, method] of routes) {
      for (const preflight of [false, true]) {
        const answer = await broker.fetch(`${broker.origin}${path}`, {
          method: preflight ? "OPTIONS" : method,
          headers: { origin, "access-control-request-method": method ?? "" },
        });
        expect(answer.status).toBe(403);
        expect(answer.headers.get("access-control-allow-origin")).toBeNull();
        await answer.body?.cancel();
      }
    }
    const signed = await broker.fetch(
      `${broker.origin}${BROKER_ROUTES.environment(environmentId)}`,
      {
        method: "DELETE",
        headers: { origin, "nyte-proof": "invalid" },
      },
    );
    expect(signed.status).toBe(403);
    expect(signed.headers.get("access-control-allow-origin")).toBeNull();
    await signed.body?.cancel();

    const headers = await broker.fetch(`${broker.origin}${BROKER_ROUTES.environments}`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "nyte-proof",
      },
    });
    expect(headers.status).toBe(403);
    expectCors(headers, origin);
    await headers.body?.cancel();
  });

  it("leaves native requests and their OPTIONS behavior unchanged", async () => {
    const input = await enrolled();
    const answer = await phone(input, "/sessions.list");
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe("POST /sessions.list");
    expect(answer.headers.get("access-control-allow-origin")).toBeNull();
    const options = await phone(input, "/sessions.list", { method: "OPTIONS" });
    expect(await wireError(options)).toEqual(refused(405, "method_not_allowed"));
    expect(options.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("phone requests", () => {
  it("forwards only allowlisted headers and answers no-store unless the desktop says otherwise", async () => {
    const seen: unknown[] = [];
    const { environmentId, desktop, bearer } = await enrolled(async (request) => {
      seen.push({ method: request.method, path: request.path, headers: request.headers });

      return request.path === "/models.list"
        ? { status: 200, headers: { "cache-control": "max-age=60" }, body: "cached" }
        : {
            status: 201,
            headers: {
              "content-type": "application/json",
              "x-nyte-host": "host_1",
              "x-nyte-version": "v1",
              "x-nyte-mime": "text/plain",
            },
            body: new TextDecoder().decode(request.body),
          };
    });
    const answer = await phone({ environmentId, bearer }, "/files.write", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/octet-stream",
        "last-event-id": "7",
        "x-nyte-input": "eyJwYXRoIjoiYSJ9",
        cookie: "session=secret",
        "x-forwarded-for": "10.0.0.1",
      },
      body: '{"title":"hi"}',
    });

    expect(answer.status).toBe(201);
    expect(await answer.text()).toBe('{"title":"hi"}');
    expect(answer.headers.get("content-type")).toBe("application/json");
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(answer.headers.get("x-nyte-host")).toBe("host_1");
    expect(answer.headers.get("x-nyte-version")).toBe("v1");
    expect(answer.headers.get("x-nyte-mime")).toBe("text/plain");
    expect(seen).toEqual([
      {
        method: "POST",
        path: "/files.write",
        headers: {
          authorization: `Bearer ${bearer}`,
          accept: "application/json",
          "content-type": "application/octet-stream",
          "x-nyte-input": "eyJwYXRoIjoiYSJ9",
        },
      },
    ]);
    const cached = await phone({ environmentId, bearer }, "/models.list");

    expect(cached.headers.get("cache-control")).toBe("max-age=60");
    expect(desktop.pending("reset")).toEqual([]);
  });

  it("answers a bodyless status with no body", async () => {
    const { environmentId, bearer } = await enrolled(async () => ({ status: 204 }));
    const answer = await phone({ environmentId, bearer }, "/session.remove");

    expect(answer.status).toBe(204);
    expect(await answer.text()).toBe("");
  });

  it("refuses before forwarding: route, method, Origin, size, bearer, and an offline desktop", async () => {
    const { environmentId, desktop, bearer } = await enrolled();
    const other = await enrolled(echo, "user_bob");

    desktop.handler = undefined;
    const checks: [string, Promise<Response>, ReturnType<typeof refused>][] = [
      [
        "the enroll route",
        phone({ environmentId, bearer }, "/_nyte/connect/enroll", { method: "POST" }),
        refused(404, "not_found"),
      ],
      [
        "a path outside the table",
        phone({ environmentId, bearer }, "/admin"),
        refused(404, "not_found"),
      ],
      ["the old API", phone({ environmentId, bearer }, "/v1/info"), refused(404, "not_found")],
      [
        "a query on an operation",
        phone({ environmentId, bearer }, "/sessions.list?x=1"),
        refused(404, "not_found"),
      ],
      [
        "a dot segment",
        phone({ environmentId, bearer }, "/x/%2e%2e/secret"),
        refused(404, "not_found"),
      ],
      [
        "an encoded slash",
        phone({ environmentId, bearer }, "/a%2Fsessions.list"),
        refused(404, "not_found"),
      ],
      [
        "GET on an operation",
        phone({ environmentId, bearer }, "/sessions.list", { method: "GET" }),
        refused(405, "method_not_allowed"),
      ],
      [
        "POST on discovery",
        phone({ environmentId, bearer }, "/.nyte/describe"),
        refused(405, "method_not_allowed"),
      ],
      [
        "an unknown environment",
        phone({ environmentId: crypto.randomUUID(), bearer }, "/sessions.list"),
        refused(401, "unauthorized"),
      ],
      [
        "PUT",
        phone({ environmentId, bearer }, "/sessions.list", { method: "PUT" }),
        refused(405, "method_not_allowed"),
      ],
      [
        "DELETE on the API",
        phone({ environmentId, bearer }, "/sessions.list", { method: "DELETE" }),
        refused(405, "method_not_allowed"),
      ],
      [
        "a browser",
        phone({ environmentId, bearer }, "/sessions.list", {
          headers: { origin: "https://evil.example" },
        }),
        refused(403, "forbidden"),
      ],
      [
        "a declared oversize body",
        phone({ environmentId, bearer }, "/sessions.list", {
          method: "POST",
          body: new Uint8Array(RELAY_BODY_LIMIT_BYTES + 1),
        }),
        refused(413, "payload_too_large"),
      ],
      ["no bearer", phone({ environmentId }, "/sessions.list"), refused(401, "unauthorized")],
      [
        "an unknown bearer",
        phone({ environmentId, bearer: deviceToken() }, "/sessions.list"),
        refused(401, "unauthorized"),
      ],
      [
        "a malformed bearer",
        phone({ environmentId, bearer: "not-a-token" }, "/sessions.list"),
        refused(401, "unauthorized"),
      ],
      [
        "another environment's bearer",
        phone({ environmentId, bearer: other.bearer }, "/sessions.list"),
        refused(401, "unauthorized"),
      ],
    ];

    for (const [label, answer, expected] of checks)
      expect({ label, ...(await wireError(await answer)) }).toEqual({ label, ...expected });

    expect(desktop.pending("open")).toEqual([]);
    desktop.close();
    await desktop.closed;
    await waitFor(async () => {
      const rows = await broker.query(
        "SELECT relay_session FROM environments WHERE id = ?1",
        environmentId,
      );

      return JSON.stringify(rows) === '[{"relay_session":null}]';
    });
    expect(await wireError(await phone({ environmentId, bearer }, "/sessions.list"))).toEqual(
      refused(503, "closed"),
    );
  });

  it("forwards a phone's own release for a live device and refuses it once revoked", async () => {
    const releases: string[] = [];
    const { environmentId, bearer, deviceId } = await enrolled(async (request) => {
      releases.push(`${request.method} ${request.path} ${request.headers.authorization ?? ""}`);

      return { status: 204 };
    });
    const release = () =>
      phone({ environmentId, bearer }, "/_nyte/connect/device", { method: "DELETE" });

    expect((await release()).status).toBe(204);
    expect(releases).toEqual([`DELETE /_nyte/connect/device Bearer ${bearer}`]);
    expect(
      await wireError(await phone({ environmentId, bearer }, "/_nyte/connect/device")),
    ).toEqual(refused(405, "method_not_allowed"));
    await broker.query(
      "UPDATE devices SET state = 'reserved', revoke_reason = NULL WHERE id = ?1",
      deviceId,
    );
    expect((await release()).status).toBe(204);
    expect(await wireError(await phone({ environmentId, bearer }, "/sessions.list"))).toEqual(
      refused(401, "unauthorized"),
    );
    await broker.query(
      "UPDATE devices SET state = 'revoked', revoke_reason = 'released' WHERE id = ?1",
      deviceId,
    );
    expect(await wireError(await release())).toEqual(refused(403, "forbidden"));
  });

  it.skipIf(abortBeforeHeadKeepsSocket)(
    "refuses past the channel limit with closed, and resets every abandoned channel",
    async () => {
      const { environmentId, desktop, bearer } = await enrolled();

      desktop.handler = undefined;
      const aborts = Array.from({ length: RELAY_CHANNEL_LIMIT }, () => new AbortController());
      const pending = aborts.map((abort) =>
        phone({ environmentId, bearer }, "/head.view", { signal: abort.signal }).catch(
          () => undefined,
        ),
      );
      const opened = [];

      for (let index = 0; index < RELAY_CHANNEL_LIMIT; index += 1)
        opened.push((await desktop.next("open")).ch);
      expect(await wireError(await phone({ environmentId, bearer }, "/sessions.list"))).toEqual(
        refused(503, "closed"),
      );

      for (const abort of aborts) abort.abort();
      await Promise.all(pending);
      await answerUntilReset(desktop, opened, "send");
    },
  );
});
