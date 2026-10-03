/**
 * The relay transport against a real `ws` relay and a real loopback HTTP
 * server: every byte crosses the global `WebSocket`, the contract's framing
 * and credit rules as the fixture enforces them, and `node:http` to the
 * listener's port.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { afterEach, test, vi } from "vitest";
import {
  RELAY_BODY_LIMIT_BYTES,
  RELAY_CHANNEL_LIMIT,
  RELAY_CHUNK_BYTES,
  RELAY_CLOSE,
  RELAY_WINDOW_BYTES,
  encodeChunks,
} from "@nyte-ai/connect/relay";
import { randomId } from "@nyte-ai/connect/signing";
import { RelayConnection } from "./connect-relay.ts";
import type { RelayConnectionOptions, RelayTiming } from "./connect-relay.ts";
import { RelayServer } from "./fixtures/relay-server.ts";

const ORIGIN = "https://relay.nyte.test";

const RELAY_URL =
  "wss://relay.nyte.test/v1/environments/3f0c2a4e-8d2b-4c1a-9e3f-1a2b3c4d5e6f/relay";

const PROOF = "eyJhbGciOiJFZERTQSJ9.e30.c2lnbmF0dXJl";

const BIG = 16 * 1024 * 1024;

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Deterministic bytes, so a body can be checked without keeping a copy. */
function pattern(offset: number, length: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, index) => (offset + index) % 251));
}

interface Local {
  readonly port: number;
  /** Bytes `/v1/big` has handed to its response. */
  written: number;
  /** While set, `/v1/upload` reads nothing. */
  uploadGate: PromiseWithResolvers<void> | undefined;
  uploadsAborted: number;
  holdsClosed: number;
}

async function localServer(): Promise<Local> {
  const server = createServer((request, response) => {
    switch (request.url) {
      case "/v1/echo?x=1":
        response.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
          "set-cookie": "session=leak",
          location: "https://elsewhere.test/",
          "access-control-allow-origin": "*",
          "x-extra": "1",
        });
        response.end(
          JSON.stringify({ method: request.method, url: request.url, headers: request.headers }),
        );

        return;
      case "/v1/redirect":
        response.writeHead(302, { location: "http://127.0.0.1:1/" });
        response.end();

        return;
      case "/v1/empty-204":
        response.writeHead(204);
        response.end();

        return;
      case "/v1/empty-205":
        response.writeHead(205, { "content-length": "0" });
        response.end();

        return;
      case "/v1/big": {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        let offset = 0;

        const pump = (): void => {
          while (offset < BIG) {
            const chunk = pattern(offset, Math.min(65_536, BIG - offset));
            offset += chunk.byteLength;
            local.written = offset;

            if (!response.write(chunk)) {
              response.once("drain", pump);

              return;
            }
          }

          response.end();
        };

        pump();

        return;
      }

      case "/v1/hold":
        response.writeHead(200, { "content-type": "text/plain" });
        response.write("x");
        response.on("close", () => {
          if (!response.writableEnded) local.holdsClosed += 1;
        });

        return;
      case "/v1/upload": {
        request.on("close", () => {
          if (!request.complete) local.uploadsAborted += 1;
        });
        void (local.uploadGate?.promise ?? Promise.resolve()).then(() => {
          const hash = createHash("sha256");
          let bytes = 0;
          request.on("data", (chunk: Buffer) => {
            bytes += chunk.byteLength;
            hash.update(chunk);
          });
          request.on("end", () => {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({ bytes, digest: hash.digest("base64url") }));
          });
        });

        return;
      }

      default:
        response.writeHead(404);
        response.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  assert.ok(Value.Check(Type.Object({ port: Type.Number() }), address));

  const local: Local = {
    port: address.port,
    written: 0,
    uploadGate: undefined,
    uploadsAborted: 0,
    holdsClosed: 0,
  };

  return local;
}

async function harness(
  options: {
    readonly proof?: RelayConnectionOptions["proof"];
    readonly dial?: RelayConnectionOptions["dial"];
    readonly timing?: Partial<RelayTiming>;
  } = {},
) {
  const local = await localServer();
  const relay = await RelayServer.start({ origin: ORIGIN, authenticate: async () => undefined });
  cleanups.push(() => relay.stop());
  const events = { revoked: 0 };

  const open = (): RelayConnection => {
    const connection = new RelayConnection({
      url: RELAY_URL,
      port: local.port,
      proof: options.proof ?? (async () => PROOF),
      dial: options.dial ?? relay.dial,
      onChange: () => undefined,
      onRevoked: () => {
        events.revoked += 1;
      },
      timing: { retryMinMs: 20, retryMaxMs: 40, ...options.timing },
    });

    cleanups.push(() => connection.close());

    return connection;
  };

  return { local, relay, events, open };
}

async function connected(connection: RelayConnection): Promise<void> {
  await vi.waitFor(() => assert.deepEqual(connection.status(), { kind: "connected" }));
}

test("a relayed request reaches only the listener's port, and only allowlisted headers and statuses cross", async () => {
  const { local, relay, open } = await harness();
  const connection = open();
  connection.start();
  await connected(connection);

  const response = await relay.exchange({
    method: "GET",
    path: "/v1/echo?x=1",
    headers: { authorization: "Bearer device", accept: "application/json" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual([...response.headers.keys()].sort(), ["cache-control", "content-type"]);
  const echoed: unknown = await response.json();
  assert.deepEqual(echoed, {
    method: "GET",
    url: "/v1/echo?x=1",
    headers: {
      host: `127.0.0.1:${String(local.port)}`,
      authorization: "Bearer device",
      accept: "application/json",
      connection: "close",
    },
  });

  // A redirect is never followed or passed on: the exchange is reset.
  assert.equal((await relay.exchange({ method: "GET", path: "/v1/redirect" })).status, 503);
  assert.equal(relay.resets, 1);

  for (const status of [204, 205]) {
    const empty = await relay.exchange({ method: "GET", path: `/v1/empty-${String(status)}` });
    assert.equal(empty.status, status);
    assert.equal(empty.body, null);
  }

  assert.deepEqual(relay.violations, []);
});

test("a response moves only as the relay grants credit, and the local server waits meanwhile", async () => {
  const { local, relay, open } = await harness();
  const connection = open();
  connection.start();
  await connected(connection);

  const response = await relay.exchange({ method: "GET", path: "/v1/big" });
  await vi.waitFor(() => assert.equal(relay.received, RELAY_WINDOW_BYTES));
  await sleep(300);
  assert.equal(relay.received, RELAY_WINDOW_BYTES);
  const stalled = local.written;
  assert.ok(stalled < BIG, "the desktop kept draining the local response without credit");
  await sleep(100);
  assert.equal(local.written, stalled);

  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(body.byteLength, BIG);
  assert.ok(body.equals(pattern(0, BIG)));
  assert.deepEqual(relay.violations, []);
}, 30_000);

test("request bytes are credited only as the local socket takes them", async () => {
  const { local, relay, open } = await harness();
  const connection = open();
  connection.start();
  await connected(connection);
  local.uploadGate = Promise.withResolvers();
  const body = randomBytes(RELAY_BODY_LIMIT_BYTES);

  const answered = relay.exchange({
    method: "POST",
    path: "/v1/upload",
    headers: { "content-type": "application/octet-stream" },
    body,
  });

  await vi.waitFor(() => assert.ok(relay.uploaded >= RELAY_WINDOW_BYTES));
  await sleep(300);
  const stalled = relay.uploaded;
  await sleep(200);
  assert.equal(relay.uploaded, stalled, "credit came back for bytes the server never read");
  assert.ok(stalled < body.byteLength);

  local.uploadGate.resolve();
  const response = await answered;
  assert.deepEqual(await response.json(), {
    bytes: body.byteLength,
    digest: createHash("sha256").update(body).digest("base64url"),
  });
  assert.deepEqual(relay.violations, []);
}, 30_000);

test("a body past the limit resets the exchange and aborts the local request", async () => {
  const { local, relay, open } = await harness();
  const connection = open();
  connection.start();
  await connected(connection);

  const response = await relay.exchange({
    method: "POST",
    path: "/v1/upload",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array(RELAY_BODY_LIMIT_BYTES + 1),
  });

  assert.equal(response.status, 503);
  await vi.waitFor(() => assert.equal(local.uploadsAborted, 1));
  assert.deepEqual(relay.violations, []);
  assert.deepEqual(connection.status(), { kind: "connected" });
}, 30_000);

test("a phone going away, dropped streams, or a lost socket ends the local exchange mid-stream", async () => {
  const { local, relay, open } = await harness();
  const connection = open();
  connection.start();
  await connected(connection);

  const hold = async (signal?: AbortSignal) => {
    const response = await relay.exchange({ method: "GET", path: "/v1/hold", signal });
    assert.ok(response.body);
    const reader = response.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "x");

    return reader;
  };

  const leaving = new AbortController();
  await hold(leaving.signal);
  leaving.abort();
  await vi.waitFor(() => assert.equal(local.holdsClosed, 1));

  const dropped = await hold();
  connection.dropStreams();
  await assert.rejects(dropped.read());
  await vi.waitFor(() => assert.equal(local.holdsClosed, 2));
  assert.deepEqual(connection.status(), { kind: "connected" });

  const lost = await hold();
  relay.close(1011);
  await assert.rejects(lost.read());
  await vi.waitFor(() => assert.equal(local.holdsClosed, 3));
  await connected(connection);
  assert.equal(relay.auths, 2);
  assert.deepEqual(relay.violations, []);
});

test("a frame that breaks the contract closes the socket, and it comes back with a fresh proof", async () => {
  const { local, relay, open } = await harness();
  const connection = open();
  connection.start();
  await connected(connection);

  const openFrame = (path: string, ch = randomId(), method = "GET", headers = {}) =>
    JSON.stringify({ t: "open", ch, method, path, headers });

  const breaking: readonly [string, () => Promise<void> | void][] = [
    ["a dot segment", () => relay.send(openFrame("/v1/../_nyte/connect/enroll"))],
    ["an encoded slash", () => relay.send(openFrame("/v1/a%2Fb"))],
    ["a path outside the allowlist", () => relay.send(openFrame("/index.html"))],
    ["a desktop route with a query", () => relay.send(openFrame("/_nyte/connect/device?x=1"))],
    ["another method", () => relay.send(openFrame("/v1/echo", randomId(), "PUT"))],
    [
      "a header outside the allowlist",
      () => relay.send(openFrame("/v1/echo", randomId(), "GET", { origin: ORIGIN })),
    ],
    ["a binary message", () => relay.send(Buffer.from("{}"))],
    ["a second ready", () => relay.send('{"t":"ready"}')],
    [
      "a live channel id opened again",
      () => {
        const ch = randomId();
        relay.send(openFrame("/v1/hold", ch));
        relay.send(openFrame("/v1/hold", ch));
      },
    ],
    [
      "one channel past the limit",
      () => {
        for (let index = 0; index <= RELAY_CHANNEL_LIMIT; index += 1)
          relay.send(openFrame("/v1/hold"));
      },
    ],
    [
      "request data after its end",
      () => {
        const ch = randomId();
        relay.send(openFrame("/v1/upload", ch, "POST"));
        relay.send(JSON.stringify({ t: "end", ch }));
        relay.send(JSON.stringify({ t: "data", ch, data: encodeChunks(new Uint8Array(4))[0] }));
      },
    ],
    [
      "credit past the window",
      () => {
        const ch = randomId();
        relay.send(openFrame("/v1/hold", ch));
        relay.send(JSON.stringify({ t: "end", ch }));
        relay.send(JSON.stringify({ t: "credit", ch, bytes: RELAY_WINDOW_BYTES }));
      },
    ],
    [
      "request data past the credit it was given",
      async () => {
        local.uploadGate = Promise.withResolvers();
        const ch = randomId();
        void relay.exchange({
          ch,
          method: "POST",
          path: "/v1/upload",
          body: new Uint8Array(RELAY_BODY_LIMIT_BYTES),
        });
        // Stalled on credit: less than a chunk of room is left.
        await vi.waitFor(async () => {
          const before = relay.uploaded;
          await sleep(200);
          assert.ok(before > 0 && relay.uploaded === before);
        });
        relay.send(
          JSON.stringify({
            t: "data",
            ch,
            data: encodeChunks(new Uint8Array(RELAY_CHUNK_BYTES))[0],
          }),
        );
      },
    ],
  ];

  for (const [name, send] of breaking) {
    const auths = relay.auths;
    const closes = relay.closes.length;
    await send();
    await vi.waitFor(() => assert.equal(relay.closes.length, closes + 1, name));
    assert.equal(relay.closes.at(-1), RELAY_CLOSE.invalid, name);
    await vi.waitFor(() => assert.equal(relay.auths, auths + 1, name));
    await connected(connection);
  }

  local.uploadGate?.resolve();

  // Frames for a channel that is already over are expected and ignored.
  const auths = relay.auths;
  relay.send(JSON.stringify({ t: "reset", ch: randomId() }));
  relay.send(JSON.stringify({ t: "credit", ch: randomId(), bytes: 1 }));
  const response = await relay.exchange({ method: "GET", path: "/v1/empty-204" });
  assert.equal(response.status, 204);
  assert.equal(relay.auths, auths);
  assert.deepEqual(relay.violations, []);
}, 60_000);

test("a replaced relay stays stopped, even on wake; a revoked one asks first and comes back", async () => {
  const { relay, events, open } = await harness();
  const connection = open();
  connection.start();
  await connected(connection);

  relay.close(RELAY_CLOSE.revoked);
  await vi.waitFor(() => assert.equal(relay.auths, 2));
  assert.equal(events.revoked, 1);
  await connected(connection);

  // Another instance proves itself for the same environment and takes over.
  const other = open();
  other.start();
  await connected(other);
  await vi.waitFor(() =>
    assert.deepEqual(connection.status(), { kind: "failed", reason: "replaced" }),
  );
  connection.reconnect();
  await sleep(200);
  assert.deepEqual(connection.status(), { kind: "failed", reason: "replaced" });
  assert.equal(relay.auths, 3);
  assert.deepEqual(other.status(), { kind: "connected" });
  assert.deepEqual(relay.violations, []);
});

test("a relay that stops answering pings is dropped and dialed again", async () => {
  const { relay, open } = await harness({ timing: { pingMs: 100 } });
  const connection = open();
  connection.start();
  await connected(connection);
  await sleep(350);
  assert.equal(relay.auths, 1);

  relay.muted = true;
  await vi.waitFor(() => assert.equal(relay.closes.length, 1));
  relay.muted = false;
  await vi.waitFor(() => assert.equal(relay.auths, 2));
  await connected(connection);
});

test("a proof or dial that lands after a close or a newer dial opens nothing", async () => {
  const proofs: PromiseWithResolvers<string>[] = [];
  let dials = 0;

  const { relay, open } = await harness({
    proof: () => {
      const proof = Promise.withResolvers<string>();
      proofs.push(proof);

      return proof.promise;
    },
    dial: (url) => {
      dials += 1;

      if (dials === 1) throw new TypeError("No network");

      return relay.dial(url);
    },
  });

  // Closed while its proof was being signed.
  const closed = open();
  closed.start();
  await vi.waitFor(() => assert.equal(proofs.length, 1));
  closed.close();
  proofs[0]?.resolve(PROOF);
  await sleep(100);
  assert.equal(dials, 0);
  assert.deepEqual(closed.status(), { kind: "stopped" });

  // Woken while its proof was being signed: only the newer dial goes out, and a failed dial retries.
  const woken = open();
  woken.start();
  await vi.waitFor(() => assert.equal(proofs.length, 2));
  woken.reconnect();
  await vi.waitFor(() => assert.equal(proofs.length, 3));
  proofs[2]?.resolve(PROOF);
  await vi.waitFor(() => assert.equal(proofs.length, 4));
  assert.equal(dials, 1);
  proofs[3]?.resolve(PROOF);
  await connected(woken);
  proofs[1]?.resolve(PROOF);
  await sleep(100);
  assert.equal(dials, 2);
  assert.equal(relay.auths, 1);
  assert.deepEqual(relay.closes, []);
});
