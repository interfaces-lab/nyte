/**
 * The relay in real workerd: the Worker, the relay Durable Object with
 * hibernatable sockets, D1, and real WebSockets and HTTP from this process.
 */
import { randomBytes } from "node:crypto";
import { BROKER_ROUTES, EnrollResponse, EnvironmentList } from "@nyte-ai/connect";
import {
  RELAY_AUTH_TIMEOUT_MS,
  RELAY_BODY_LIMIT_BYTES,
  RELAY_CHANNEL_LIMIT,
  RELAY_CHUNK_BYTES,
  RELAY_CLOSE,
  RELAY_PING,
  RELAY_WINDOW_BYTES,
  decodeChunk,
  encodeChunks,
} from "@nyte-ai/connect/relay";
import { createProof, generateMachineKey, randomId, sha256 } from "@nyte-ai/connect/signing";
import type { PrivateJwk } from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RelayDesktop, enrollmentHandler, startWorkerdBroker } from "./workerd.ts";
import type { RelayHandler, WorkerdBroker } from "./workerd.ts";

let broker: WorkerdBroker;
const open: RelayDesktop[] = [];

beforeAll(async () => {
  broker = await startWorkerdBroker();
});

afterAll(async () => {
  await broker.close();
});

beforeEach(async () => {
  for (const desktop of open.splice(0)) desktop.close();
  await broker.reset();
});

const deviceToken = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

const echo: RelayHandler = async (request) => ({
  status: 200,
  headers: { "content-type": "text/plain" },
  body: `${request.method} ${request.path}`,
});

async function linked(userId = "user_alice"): Promise<{ environmentId: string; key: PrivateJwk }> {
  const { environmentId, key } = await broker.link({ userId });

  return { environmentId, key };
}

async function attached(input: { environmentId: string; key: PrivateJwk }): Promise<RelayDesktop> {
  const desktop = await broker.attach(input);

  open.push(desktop);

  return desktop;
}

/** A raw socket on the environment's relay that has not proven anything. */
async function socket(environmentId: string): Promise<RelayDesktop> {
  const desktop = new RelayDesktop(
    broker.localUrl(`${broker.origin}${BROKER_ROUTES.relay(environmentId)}`),
  );

  open.push(desktop);
  await desktop.opened();

  return desktop;
}

function relayProof(input: { environmentId: string; key: PrivateJwk; path?: string }) {
  return createProof({
    key: input.key,
    issuer: input.environmentId,
    audience: broker.origin,
    method: "GET",
    path: input.path ?? BROKER_ROUTES.relay(input.environmentId),
    body: "",
  });
}

/** A desktop on its relay with one enrolled phone, answering with `handler`. */
async function enrolled(handler: RelayHandler = echo, userId = "user_alice") {
  const { environmentId, key } = await linked(userId);
  const desktop = await attached({ environmentId, key });
  const bearer = deviceToken();

  desktop.handler = enrollmentHandler({
    key,
    environmentId,
    origin: broker.origin,
    brokerKeys: broker.brokerKeys,
    fallback: handler,
  });
  const answer = await broker.fetch(`${broker.origin}${BROKER_ROUTES.devices(environmentId)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await broker.sessionToken({ userId, sessionId: "sess_phone" })}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      clientId: "phone-install-0001",
      clientName: "Pocket",
      digest: await sha256(bearer),
    }),
  });
  const body: unknown = await answer.json();

  expect(answer.status).toBe(201);

  if (!Value.Check(EnrollResponse, body))
    throw new Error("Enrollment answered outside the contract");

  return { environmentId, key, desktop, bearer, deviceId: body.deviceId };
}

function phone(
  input: { environmentId: string; bearer?: string },
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (input.bearer !== undefined) headers.set("authorization", `Bearer ${input.bearer}`);

  return broker.fetch(`${broker.origin}/r/${input.environmentId}${path}`, { ...init, headers });
}

async function wireError(response: Response): Promise<{ status: number; body: unknown }> {
  const body: unknown = await response.json();

  return { status: response.status, body };
}

const refused = (status: number, code: string) => ({
  status,
  body: { ok: false, error: { code, message: expect.any(String) } },
});

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * When the relay closes a socket that never sent a frame, local workerd sends
 * the close frame and receives the client's reply, but the Node client is
 * left in CLOSING and never fires `close`. A socket that has sent anything
 * closes normally. So a never-used socket's close is observed as leaving OPEN.
 */
async function leftOpen(desktop: RelayDesktop): Promise<void> {
  while (desktop.socket.readyState === WebSocket.OPEN) await settle(50);
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await check()) return;
    await settle(100);
  }

  throw new Error("Timed out");
}

describe("the desktop's relay socket", () => {
  it("attaches with a proof for its relay path and lists online with a recent lease", async () => {
    const { environmentId, key } = await linked();
    const list = async () => {
      const response = await broker.fetch(`${broker.origin}${BROKER_ROUTES.environments}`, {
        headers: {
          authorization: `Bearer ${await broker.sessionToken({ userId: "user_alice" })}`,
        },
      });
      const body: unknown = await response.json();

      return Value.Check(EnvironmentList, body) ? body.environments[0]?.online : undefined;
    };
    const desktop = await attached({ environmentId, key });

    expect(await list()).toBe(false);
    const leaseBody = "{}";
    const lease = await broker.fetch(`${broker.origin}${BROKER_ROUTES.lease(environmentId)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "nyte-proof": await createProof({
          key,
          issuer: environmentId,
          audience: broker.origin,
          method: "POST",
          path: BROKER_ROUTES.lease(environmentId),
          body: leaseBody,
        }),
      },
      body: leaseBody,
    });

    expect(lease.status).toBe(200);
    expect(await list()).toBe(true);
    desktop.close();
    await waitFor(async () => (await list()) === false);
  });

  it("closes a socket whose first frame is not a fresh proof of the environment's key", async () => {
    const { environmentId, key } = await linked();
    const proof = await relayProof({ environmentId, key });
    const first = await socket(environmentId);

    first.send({ t: "auth", proof });
    await first.next("ready");
    const cases: [string, (desktop: RelayDesktop) => Promise<void>, number][] = [
      ["a replayed proof", async (desktop) => desktop.send({ t: "auth", proof }), 4401],
      [
        "another key",
        async (desktop) =>
          desktop.send({
            t: "auth",
            proof: await relayProof({ environmentId, key: await generateMachineKey() }),
          }),
        4401,
      ],
      [
        "another path",
        async (desktop) =>
          desktop.send({
            t: "auth",
            proof: await relayProof({
              environmentId,
              key,
              path: BROKER_ROUTES.lease(environmentId),
            }),
          }),
        4401,
      ],
      [
        "a frame other than auth",
        async (desktop) => desktop.send({ t: "end", ch: randomId() }),
        4401,
      ],
      ["a binary frame", async (desktop) => desktop.socket.send(new Uint8Array([123])), 4400],
      ["text outside the contract", async (desktop) => desktop.socket.send("{"), 4400],
    ];

    for (const [label, act, code] of cases) {
      const desktop = await socket(environmentId);

      await act(desktop);
      expect({ label, code: (await desktop.closed).code }).toEqual({ label, code });
    }

    expect(first.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("closes a socket that has not proven itself within five seconds", async () => {
    const { environmentId } = await linked();
    const started = Date.now();
    const desktop = await socket(environmentId);

    await leftOpen(desktop);
    expect(Date.now() - started).toBeGreaterThanOrEqual(RELAY_AUTH_TIMEOUT_MS - 100);
  }, 15_000);

  it("holds at most four unproven sockets, closing the oldest", async () => {
    const { environmentId, key } = await linked();
    const pending = [];

    for (let index = 0; index < 5; index += 1) pending.push(await socket(environmentId));

    if (pending[0] !== undefined) await leftOpen(pending[0]);
    expect(pending.slice(1).map((desktop) => desktop.socket.readyState)).toEqual([1, 1, 1, 1]);
    pending[4]?.send({ t: "auth", proof: await relayProof({ environmentId, key }) });
    await pending[4]?.next("ready");
  });

  it("lets a newer proof replace the authenticated socket, ending its channels", async () => {
    const { environmentId, key, desktop, bearer } = await enrolled();

    desktop.handler = undefined;
    const waiting = phone({ environmentId, bearer }, "/v1/sessions");
    const { ch } = await desktop.next("open");
    const replacement = await attached({ environmentId, key });

    expect((await desktop.closed).code).toBe(RELAY_CLOSE.replaced);
    expect(await wireError(await waiting)).toEqual(refused(503, "closed"));
    replacement.handler = echo;
    const answer = await phone({ environmentId, bearer }, "/v1/sessions");

    expect(await answer.text()).toBe("GET /v1/sessions");
    expect(ch).toEqual(expect.any(String));
  });

  it("keeps its socket and answers pings across hibernation", async () => {
    const { environmentId, desktop, bearer } = await enrolled();

    await broker.evictRelay(environmentId);
    desktop.socket.send(RELAY_PING);
    await desktop.next("pong");
    const answer = await phone({ environmentId, bearer }, "/v1/health?full=1");

    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe("GET /v1/health?full=1");
  });

  it("closes with revoked when the environment is removed, and refuses its proofs after", async () => {
    const { environmentId, key } = await linked();
    const desktop = await attached({ environmentId, key });
    const removed = await broker.fetch(
      `${broker.origin}${BROKER_ROUTES.environment(environmentId)}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${await broker.sessionToken({ userId: "user_alice" })}`,
        },
      },
    );

    expect(removed.status).toBe(204);
    expect((await desktop.closed).code).toBe(RELAY_CLOSE.revoked);
    const again = await socket(environmentId);

    again.send({ t: "auth", proof: await relayProof({ environmentId, key }) });
    expect((await again.closed).code).toBe(RELAY_CLOSE.revoked);
  });
});

describe("phone requests", () => {
  it("forwards only allowlisted headers and answers no-store unless the desktop says otherwise", async () => {
    const seen: unknown[] = [];
    const { environmentId, desktop, bearer } = await enrolled(async (request) => {
      seen.push({ method: request.method, path: request.path, headers: request.headers });

      return request.path.startsWith("/v1/cached")
        ? { status: 200, headers: { "cache-control": "max-age=60" }, body: "cached" }
        : {
            status: 201,
            headers: { "content-type": "application/json" },
            body: new TextDecoder().decode(request.body),
          };
    });
    const answer = await phone({ environmentId, bearer }, "/v1/sessions?limit=5", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie: "session=secret",
        "x-forwarded-for": "10.0.0.1",
      },
      body: '{"title":"hi"}',
    });

    expect(answer.status).toBe(201);
    expect(await answer.text()).toBe('{"title":"hi"}');
    expect(answer.headers.get("content-type")).toBe("application/json");
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(seen).toEqual([
      {
        method: "POST",
        path: "/v1/sessions?limit=5",
        headers: {
          authorization: `Bearer ${bearer}`,
          accept: "application/json",
          "content-type": "application/json",
        },
      },
    ]);
    const cached = await phone({ environmentId, bearer }, "/v1/cached");

    expect(cached.headers.get("cache-control")).toBe("max-age=60");
    expect(desktop.pending("reset")).toEqual([]);
  });

  it("answers a bodyless status with no body", async () => {
    const { environmentId, bearer } = await enrolled(async () => ({ status: 204 }));
    const answer = await phone({ environmentId, bearer }, "/v1/sessions/x", { method: "POST" });

    expect(answer.status).toBe(204);
    expect(await answer.text()).toBe("");
  });

  it("refuses before forwarding: route, method, Origin, size, bearer, and an offline desktop", async () => {
    const { environmentId, desktop, bearer, deviceId } = await enrolled();
    const other = await enrolled(echo, "user_bob");

    desktop.handler = undefined;
    const checks: [string, Promise<Response>, ReturnType<typeof refused>][] = [
      [
        "the enroll route",
        phone({ environmentId, bearer }, "/_nyte/connect/enroll", { method: "POST" }),
        refused(404, "not_found"),
      ],
      ["a path outside /v1", phone({ environmentId, bearer }, "/admin"), refused(404, "not_found")],
      [
        "a dot segment",
        phone({ environmentId, bearer }, "/v1/%2e%2e/secret"),
        refused(404, "not_found"),
      ],
      [
        "an encoded slash",
        phone({ environmentId, bearer }, "/v1/a%2Fb"),
        refused(404, "not_found"),
      ],
      [
        "an unknown environment",
        phone({ environmentId: crypto.randomUUID(), bearer }, "/v1/x"),
        refused(401, "unauthorized"),
      ],
      [
        "PUT",
        phone({ environmentId, bearer }, "/v1/x", { method: "PUT" }),
        refused(405, "method_not_allowed"),
      ],
      [
        "DELETE on the API",
        phone({ environmentId, bearer }, "/v1/x", { method: "DELETE" }),
        refused(405, "method_not_allowed"),
      ],
      [
        "a browser",
        phone({ environmentId, bearer }, "/v1/x", { headers: { origin: "https://evil.example" } }),
        refused(403, "forbidden"),
      ],
      [
        "a declared oversize body",
        phone({ environmentId, bearer }, "/v1/x", {
          method: "POST",
          body: new Uint8Array(RELAY_BODY_LIMIT_BYTES + 1),
        }),
        refused(413, "payload_too_large"),
      ],
      ["no bearer", phone({ environmentId }, "/v1/x"), refused(401, "unauthorized")],
      [
        "an unknown bearer",
        phone({ environmentId, bearer: deviceToken() }, "/v1/x"),
        refused(401, "unauthorized"),
      ],
      [
        "a malformed bearer",
        phone({ environmentId, bearer: "not-a-token" }, "/v1/x"),
        refused(401, "unauthorized"),
      ],
      [
        "another environment's bearer",
        phone({ environmentId, bearer: other.bearer }, "/v1/x"),
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
    expect(await wireError(await phone({ environmentId, bearer }, "/v1/x"))).toEqual(
      refused(503, "closed"),
    );
    expect(deviceId).toEqual(expect.any(String));
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
    expect(await wireError(await phone({ environmentId, bearer }, "/v1/x"))).toEqual(
      refused(401, "unauthorized"),
    );
    await broker.query(
      "UPDATE devices SET state = 'revoked', revoke_reason = 'released' WHERE id = ?1",
      deviceId,
    );
    expect(await wireError(await release())).toEqual(refused(403, "forbidden"));
  });

  it("refuses past the channel limit with closed, and resets every abandoned channel", async () => {
    const { environmentId, desktop, bearer } = await enrolled();

    desktop.handler = undefined;
    const aborts = Array.from({ length: RELAY_CHANNEL_LIMIT }, () => new AbortController());
    const pending = aborts.map((abort) =>
      phone({ environmentId, bearer }, "/v1/slow", { signal: abort.signal }).catch(() => undefined),
    );
    const opened = [];

    for (let index = 0; index < RELAY_CHANNEL_LIMIT; index += 1)
      opened.push((await desktop.next("open")).ch);
    expect(await wireError(await phone({ environmentId, bearer }, "/v1/one-more"))).toEqual(
      refused(503, "closed"),
    );

    for (const abort of aborts) abort.abort();
    await Promise.all(pending);
    const reset = new Set<string>();

    while (reset.size < opened.length) reset.add((await desktop.next("reset")).ch);
    expect([...reset].sort()).toEqual([...opened].sort());
  });
});

describe("flow control", () => {
  it("streams an upload in chunks within the desktop's credit, and no further", async () => {
    const { environmentId, desktop, bearer } = await enrolled();
    const upload = new Uint8Array(randomBytes(RELAY_WINDOW_BYTES * 2 + 1000));

    desktop.handler = undefined;
    const answer = phone({ environmentId, bearer }, "/v1/upload", { method: "POST", body: upload });
    const { ch } = await desktop.next("open");
    const received: Uint8Array[] = [];
    const take = async () => {
      const frame = await desktop.next("data", (data) => data.ch === ch);
      const bytes = decodeChunk(frame.data);

      expect(bytes?.byteLength).toBeLessThanOrEqual(RELAY_CHUNK_BYTES);
      received.push(bytes ?? new Uint8Array());
    };
    const total = () => received.reduce((sum, bytes) => sum + bytes.byteLength, 0);

    while (total() < RELAY_WINDOW_BYTES) await take();
    await settle();
    expect(total()).toBe(RELAY_WINDOW_BYTES);
    expect(desktop.pending("data")).toEqual([]);
    expect(desktop.pending("end")).toEqual([]);

    desktop.send({ t: "credit", ch, bytes: RELAY_WINDOW_BYTES });

    while (total() < RELAY_WINDOW_BYTES * 2) await take();
    await settle();
    expect(total()).toBe(RELAY_WINDOW_BYTES * 2);
    desktop.send({ t: "credit", ch, bytes: RELAY_WINDOW_BYTES });

    while (total() < upload.byteLength) await take();
    await desktop.next("end", (end) => end.ch === ch);
    expect(Buffer.concat(received).equals(Buffer.from(upload))).toBe(true);
    desktop.send({ t: "head", ch, status: 200, headers: {} });
    desktop.send({ t: "end", ch });
    expect((await answer).status).toBe(200);
  });

  it("refuses a streamed body past the limit with 413 and resets the channel", async () => {
    const { environmentId, desktop, bearer } = await enrolled();
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > RELAY_BODY_LIMIT_BYTES + RELAY_CHUNK_BYTES) {
          controller.close();

          return;
        }
        sent += 65_536;
        controller.enqueue(new Uint8Array(65_536));
      },
    });
    const answer = await phone({ environmentId, bearer }, "/v1/upload", {
      method: "POST",
      body,
      duplex: "half",
    });

    expect(await wireError(answer)).toEqual(refused(413, "payload_too_large"));
    const opened = desktop.received.find(
      (frame) => frame.t === "open" && frame.path === "/v1/upload",
    );

    await waitFor(async () =>
      desktop.received.some(
        (frame) => frame.t === "reset" && opened?.t === "open" && frame.ch === opened.ch,
      ),
    );
  }, 20_000);

  it("returns response credit only for bytes it passed on, and delivers a large answer intact", async () => {
    const large = new Uint8Array(randomBytes(RELAY_WINDOW_BYTES * 4));
    const { environmentId, desktop, bearer } = await enrolled(async () => ({
      status: 200,
      body: large,
    }));
    const before = desktop.received.length;
    const answer = await phone({ environmentId, bearer }, "/v1/large");
    const reader = answer.body?.getReader();
    const chunks: Uint8Array[] = [];

    for (;;) {
      const next = await reader?.read();

      if (next === undefined || next.done) break;
      chunks.push(next.value);
      await settle(5);
    }

    expect(Buffer.concat(chunks).equals(Buffer.from(large))).toBe(true);
    const granted = desktop.received
      .slice(before)
      .reduce((sum, frame) => sum + (frame.t === "credit" ? frame.bytes : 0), 0);

    expect(granted).toBeLessThanOrEqual(large.byteLength);
  });

  it("closes a desktop that grants past the window or answers out of phase", async () => {
    const cases: [string, (desktop: RelayDesktop, ch: string) => void][] = [
      [
        "credit past the window",
        (desktop, ch) => desktop.send({ t: "credit", ch, bytes: RELAY_WINDOW_BYTES }),
      ],
      [
        "data before head",
        (desktop, ch) =>
          desktop.send({ t: "data", ch, data: encodeChunks(new Uint8Array([1]))[0] ?? "" }),
      ],
      [
        "a redirect",
        (desktop, ch) =>
          desktop.socket.send(JSON.stringify({ t: "head", ch, status: 302, headers: {} })),
      ],
      [
        "a cookie",
        (desktop, ch) =>
          desktop.socket.send(
            JSON.stringify({ t: "head", ch, status: 200, headers: { "set-cookie": "a=b" } }),
          ),
      ],
      [
        "data after a bodyless head",
        (desktop, ch) => {
          desktop.send({ t: "head", ch, status: 204, headers: {} });
          desktop.send({ t: "data", ch, data: encodeChunks(new Uint8Array([1]))[0] ?? "" });
        },
      ],
      [
        "a second head",
        (desktop, ch) => {
          desktop.send({ t: "head", ch, status: 200, headers: {} });
          desktop.send({ t: "head", ch, status: 200, headers: {} });
        },
      ],
    ];

    for (const [label, act] of cases) {
      const { environmentId, desktop, bearer } = await enrolled();

      desktop.handler = undefined;
      const answer = phone({ environmentId, bearer }, "/v1/x", { method: "POST", body: "{}" });
      const { ch } = await desktop.next("open");

      act(desktop, ch);
      expect({ label, code: (await desktop.closed).code }).toEqual({
        label,
        code: RELAY_CLOSE.invalid,
      });
      await (await answer).body?.cancel().catch(() => undefined);
      await broker.reset();
    }
  });
});

describe("cancellation and revocation", () => {
  it("resets the desktop's channel when the phone goes away before the response head", async () => {
    const { environmentId, desktop, bearer } = await enrolled();

    desktop.handler = undefined;
    const abort = new AbortController();
    const answer = phone({ environmentId, bearer }, "/v1/slow", { signal: abort.signal }).catch(
      (error: unknown) => error,
    );
    const { ch } = await desktop.next("open");
    abort.abort();
    await answer;
    await desktop.next("reset", (reset) => reset.ch === ch);
  });

  it("resets the desktop's channel when the phone goes away mid-stream", async () => {
    const { environmentId, desktop, bearer } = await enrolled();

    desktop.handler = undefined;
    const abort = new AbortController();
    const answer = phone({ environmentId, bearer }, "/v1/events", { signal: abort.signal });
    const { ch } = await desktop.next("open");

    desktop.send({ t: "head", ch, status: 200, headers: { "content-type": "text/event-stream" } });

    for (const data of encodeChunks(new TextEncoder().encode("data: one\n\n")))
      desktop.send({ t: "data", ch, data });
    const response = await answer;
    const reader = response.body?.getReader();

    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe("data: one\n\n");
    abort.abort();
    await desktop.next("reset", (reset) => reset.ch === ch);
  });

  it("ends a revoked device's open channels at once and refuses its bearer after", async () => {
    const { environmentId, desktop, bearer, deviceId } = await enrolled();

    desktop.handler = undefined;
    const answer = phone({ environmentId, bearer }, "/v1/events");
    const { ch } = await desktop.next("open");

    desktop.send({ t: "head", ch, status: 200, headers: { "content-type": "text/event-stream" } });
    const response = await answer;
    const reader = response.body?.getReader();
    const revoked = await broker.fetch(
      `${broker.origin}${BROKER_ROUTES.device(environmentId, deviceId)}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${await broker.sessionToken({ userId: "user_alice", sessionId: "sess_laptop" })}`,
        },
      },
    );

    expect(revoked.status).toBe(204);
    await desktop.next("reset", (reset) => reset.ch === ch);
    expect(
      await reader?.read().then(
        (next) => next.done,
        () => true,
      ),
    ).toBe(true);
    expect(await wireError(await phone({ environmentId, bearer }, "/v1/x"))).toEqual(
      refused(401, "unauthorized"),
    );
    expect(desktop.socket.readyState).toBe(WebSocket.OPEN);
  });
});
