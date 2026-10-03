/**
 * The whole Worker in local workerd, for tests that need the real relay: the
 * broker, the relay Durable Object with hibernatable sockets, and D1, started
 * with `createTestHarness` from the installed wrangler. Only Clerk's Backend
 * API is fake; session JWTs are signed with a key generated per run.
 *
 * While a broker runs, `globalThis.fetch` in this process is patched: the
 * Worker's own outbound calls to `api.clerk.com` reach `clerk`, requests to
 * `origin` reach the local Worker, loopback passes through, and anything else
 * throws. `close()` restores it. WebSockets cannot be patched, so connect them
 * to `localUrl(...)`.
 *
 * Exported for other packages' interop tests, which import it by relative
 * path. It reads no `.dev.vars` or `.env` file and no live secret.
 */
import { fileURLToPath } from "node:url";
import {
  BROKER_ROUTES,
  ENROLLMENT_LIFETIME_SECONDS,
  EnrollEnvelope,
  EnrollmentClaims,
  LinkResponse,
  TOKEN_TYPES,
} from "@nyte-ai/connect";
import type { BrokerKeys } from "@nyte-ai/connect";
import {
  RELAY_CHUNK_BYTES,
  RELAY_WINDOW_BYTES,
  decodeChunk,
  encodeChunks,
  hasNullBody,
  parseRelayFrame,
} from "@nyte-ai/connect/relay";
import type { DesktopFrame, RelayFrame, RelayResponseHeaders } from "@nyte-ai/connect/relay";
import {
  brokerKey,
  createProof,
  generateMachineKey,
  keyThumbprint,
  publicKeyOf,
  signClaims,
  verifyClaims,
} from "@nyte-ai/connect/signing";
import type { PrivateJwk } from "@nyte-ai/connect/signing";
import { SignJWT, exportSPKI, generateKeyPair } from "jose";
import { Value } from "typebox/value";
import { createTestHarness } from "wrangler";
import type { TestHarness } from "wrangler";
import type { D1Database, D1Value } from "../src/d1.ts";
import { FakeClerkApi } from "./clerk-fake.ts";

export const WORKERD_ORIGIN = "https://connect.test.example";
export const WORKERD_ISSUER = "https://clerk.test.example";
export const WORKERD_AUTHORIZED_PARTY = "https://app.test.example";

const TABLES = [
  "devices",
  "environments",
  "owners",
  "denied_sessions",
  "proof_replays",
  "rate_limits",
] as const;

const random = (bytes = 24) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");

// ---------------------------------------------------------------------------
// A desktop on its relay socket
// ---------------------------------------------------------------------------

export type OpenFrame = Extract<RelayFrame, { t: "open" }>;

/** A relayed request as the desktop sees it once the relay sent `end`. */
export interface RelayedRequest {
  readonly ch: string;
  readonly method: OpenFrame["method"];
  readonly path: string;
  readonly headers: OpenFrame["headers"];
  readonly body: Uint8Array;
}

export interface RelayedResponse {
  readonly status: number;
  readonly headers?: RelayResponseHeaders;
  readonly body?: string | Uint8Array;
}

export type RelayHandler = (request: RelayedRequest) => Promise<RelayedResponse>;

interface ServedChannel {
  readonly open: OpenFrame;
  readonly chunks: Uint8Array[];
  credit: number;
  creditArrived: (() => void) | undefined;
  reset: boolean;
}

/**
 * A desktop's relay socket over a real WebSocket. With `handler` set, it
 * answers every channel itself, granting credit as it reads and sending
 * within the credit it holds; frames it handles are not queued for `next`.
 * `received` keeps every frame.
 */
export class RelayDesktop {
  readonly socket: WebSocket;
  readonly closed: Promise<{ readonly code: number; readonly reason: string }>;
  readonly received: RelayFrame[] = [];
  handler: RelayHandler | undefined;
  private readonly unread: RelayFrame[] = [];
  private readonly waiters: (() => void)[] = [];
  private readonly served = new Map<string, ServedChannel>();

  constructor(url: URL) {
    this.socket = new WebSocket(url);
    this.closed = new Promise((resolve) => {
      this.socket.addEventListener("close", (event) =>
        resolve({ code: event.code, reason: event.reason }),
      );
    });
    this.socket.addEventListener("message", (event) => {
      const frame = parseRelayFrame(event.data);

      if (frame === undefined) throw new Error("The relay sent a frame outside the contract");
      this.received.push(frame);

      if (!this.serve(frame)) this.unread.push(frame);

      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("error", () => reject(new Error("The relay refused")), {
        once: true,
      });
    });
  }

  /** The first unread frame that matches, waiting for it if none has arrived. */
  async next<T extends RelayFrame["t"]>(
    t: T,
    match: (frame: Extract<RelayFrame, { t: T }>) => boolean = () => true,
  ): Promise<Extract<RelayFrame, { t: T }>> {
    for (;;) {
      for (const [index, frame] of this.unread.entries())
        if (isFrame(frame, t) && match(frame)) {
          this.unread.splice(index, 1);

          return frame;
        }

      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  /** Unread frames of one type, without waiting. */
  pending<T extends RelayFrame["t"]>(t: T): Extract<RelayFrame, { t: T }>[] {
    return this.unread.filter((frame) => isFrame(frame, t));
  }

  send(frame: DesktopFrame): void {
    this.socket.send(JSON.stringify(frame));
  }

  close(): void {
    this.socket.close();
  }

  /** True when the handler took the frame: a channel it opened or serves. */
  private serve(frame: RelayFrame): boolean {
    const handler = this.handler;

    if (frame.t === "open") {
      if (handler === undefined) return false;
      this.served.set(frame.ch, {
        open: frame,
        chunks: [],
        credit: RELAY_WINDOW_BYTES,
        creditArrived: undefined,
        reset: false,
      });

      return true;
    }

    if (frame.t === "ready" || frame.t === "pong") return false;
    const channel = this.served.get(frame.ch);

    if (channel === undefined) return false;

    switch (frame.t) {
      case "data": {
        const bytes = decodeChunk(frame.data);

        if (bytes !== undefined) {
          channel.chunks.push(bytes);
          this.send({ t: "credit", ch: frame.ch, bytes: bytes.byteLength });
        }
        break;
      }
      case "end":
        if (handler !== undefined) void this.answer(handler, channel);
        break;
      case "credit":
        channel.credit += frame.bytes;
        channel.creditArrived?.();
        break;
      case "reset":
        channel.reset = true;
        channel.creditArrived?.();
        this.served.delete(frame.ch);
        break;
      default: {
        const _exhaustive: never = frame;
        return _exhaustive;
      }
    }

    return true;
  }

  private async answer(handler: RelayHandler, channel: ServedChannel): Promise<void> {
    const { ch, method, path, headers } = channel.open;
    const response = await handler({
      ch,
      method,
      path,
      headers,
      body: Buffer.concat(channel.chunks),
    });
    const body =
      typeof response.body === "string"
        ? new TextEncoder().encode(response.body)
        : (response.body ?? new Uint8Array());

    this.send({ t: "head", ch, status: response.status, headers: response.headers ?? {} });

    if (!hasNullBody(response.status))
      for (const data of encodeChunks(body)) {
        const size = decodeChunk(data)?.byteLength ?? RELAY_CHUNK_BYTES;

        while (channel.credit < size && !channel.reset)
          await new Promise<void>((resolve) => {
            channel.creditArrived = resolve;
          });

        if (channel.reset) return;
        channel.credit -= size;
        this.send({ t: "data", ch, data });
      }

    this.send({ t: "end", ch });
    this.served.delete(ch);
  }
}

function isFrame<T extends RelayFrame["t"]>(
  frame: RelayFrame,
  t: T,
): frame is Extract<RelayFrame, { t: T }> {
  return frame.t === t;
}

/**
 * A handler for `POST /_nyte/connect/enroll` as a desktop answers it: verify
 * the broker's grant, record nothing, sign the receipt. Other paths go to
 * `fallback`.
 */
export function enrollmentHandler(input: {
  readonly key: PrivateJwk;
  readonly environmentId: string;
  readonly origin: string;
  readonly brokerKeys: BrokerKeys;
  readonly fallback?: RelayHandler;
  /** Every grant the desktop accepted, in order. */
  readonly grants?: EnrollmentClaims[];
}): RelayHandler {
  return async (request) => {
    if (request.path !== "/_nyte/connect/enroll")
      return input.fallback === undefined ? { status: 404 } : input.fallback(request);
    const envelope: unknown = JSON.parse(new TextDecoder().decode(request.body));

    if (!Value.Check(EnrollEnvelope, envelope)) return { status: 400 };
    const key = brokerKey(input.brokerKeys, envelope.authorization);

    if (key === undefined) return { status: 401 };
    const grant = await verifyClaims({
      token: envelope.authorization,
      key,
      typ: TOKEN_TYPES.enrollment,
      issuer: input.origin,
      audience: input.environmentId,
      schema: EnrollmentClaims,
      lifetime: ENROLLMENT_LIFETIME_SECONDS,
    });

    input.grants?.push(grant);
    const iat = Math.floor(Date.now() / 1000);
    const receipt = await signClaims({
      key: input.key,
      typ: TOKEN_TYPES.receipt,
      claims: {
        iss: input.environmentId,
        aud: input.origin,
        iat,
        exp: iat + ENROLLMENT_LIFETIME_SECONDS,
        req: grant.jti,
        nonce: grant.nonce,
        deviceId: grant.deviceId,
        digest: grant.digest,
      },
    });

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receipt }),
    };
  };
}

// ---------------------------------------------------------------------------
// The broker
// ---------------------------------------------------------------------------

export interface WorkerdBroker {
  /** `CONNECT_ORIGIN`: proofs' and Clerk's `aud`, and the base of relay addresses. */
  readonly origin: string;
  /** Where the Worker listens, `http://127.0.0.1:<port>/`. */
  readonly local: URL;
  readonly brokerKeys: BrokerKeys;
  readonly clerk: FakeClerkApi;
  /** An `origin` URL on the local Worker: `https:` becomes `http:`, `wss:` becomes `ws:`. */
  localUrl(url: string | URL): URL;
  /**
   * The unpatched fetch. A request for `origin` is dispatched straight to the
   * Worker, as the edge would, not through wrangler's dev proxy: that proxy
   * never passes a caller's disconnect on, so `request.signal` would not fire.
   */
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  /** A Clerk session JWT the broker accepts. */
  sessionToken(input: {
    readonly userId: string;
    readonly sessionId?: string;
    readonly claims?: Record<string, unknown>;
    readonly lifetimeSeconds?: number;
  }): Promise<string>;
  /** Rows from the Worker's D1, for assertions and setup. */
  query(sql: string, ...bindings: D1Value[]): Promise<unknown[]>;
  /**
   * Evict the environment's relay from memory. `hibernate` (the default)
   * keeps its sockets open; `close` drops them, as a deploy or crash would.
   */
  evictRelay(
    environmentId: string,
    options?: { readonly webSockets?: "hibernate" | "close" },
  ): Promise<void>;
  /** The Worker's and relay's runtime log lines since start or `reset()`, for diagnostics. */
  logs(): ReturnType<TestHarness["getLogs"]>;
  /** Link a desktop key through the real route, as a Clerk user Clerk knows. */
  link(input: {
    readonly userId: string;
    readonly key?: PrivateJwk;
    readonly name?: string;
  }): Promise<{
    readonly environmentId: string;
    readonly key: PrivateJwk;
    readonly link: LinkResponse;
  }>;
  /** Open the environment's relay socket and prove its key; resolves on `ready`. */
  attach(input: {
    readonly environmentId: string;
    readonly key: PrivateJwk;
  }): Promise<RelayDesktop>;
  /** Empty every D1 table, the Clerk fake, and the logs. Relay objects keep their sockets. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function startWorkerdBroker(): Promise<WorkerdBroker> {
  const clerkKeys = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const signingKey = { ...(await generateMachineKey()), kid: "broker-test-1" };
  const clerkSecretKey = `sk_test_${random()}`;
  const clerk = new FakeClerkApi(clerkSecretKey);
  const brokerKeys: BrokerKeys = {
    keys: [{ kty: "OKP", crv: "Ed25519", x: signingKey.x, kid: signingKey.kid }],
  };
  const server = createTestHarness({
    root: fileURLToPath(new URL(".", import.meta.url)),
    workers: [
      {
        configPath: "./workerd.jsonc",
        secrets: {
          CONNECT_ORIGIN: WORKERD_ORIGIN,
          CLERK_ISSUER: WORKERD_ISSUER,
          CLERK_AUTHORIZED_PARTIES: WORKERD_AUTHORIZED_PARTY,
          CLERK_JWT_KEY: await exportSPKI(clerkKeys.publicKey),
          CLERK_SECRET_KEY: clerkSecretKey,
          CLERK_WEBHOOK_SIGNING_SECRET: `whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")}`,
          BROKER_SIGNING_KEYS: JSON.stringify([signingKey]),
        },
      },
    ],
  });
  const { url: local } = await server.listen();
  const worker = server.getWorker();

  await worker.applyD1Migrations("DB");
  const { DB: db } = await server.getWorker<{ DB: D1Database }>().getEnv();
  const original = globalThis.fetch;
  const localUrl = (url: string | URL): URL => {
    const parsed = new URL(url);
    const mapped = new URL(`${parsed.pathname}${parsed.search}`, local);

    if (parsed.protocol === "wss:" || parsed.protocol === "ws:") mapped.protocol = "ws:";

    return mapped;
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);

    if (url.origin === "https://api.clerk.com")
      return clerk.handle(url, input instanceof Request ? input : (init ?? {}));

    if (url.origin === WORKERD_ORIGIN) return broker.fetch(input, init);

    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return original(input, init);

    throw new TypeError(`Unexpected egress to ${url.origin}`);
  };

  const broker: WorkerdBroker = {
    origin: WORKERD_ORIGIN,
    local,
    brokerKeys,
    clerk,
    localUrl,
    async fetch(input, init) {
      const body = init?.body;

      // Their encoding is the runtime Request's to make, not the dispatcher's undici.
      if (body instanceof Blob || body instanceof FormData)
        return broker.fetch(new Request(input, init));
      const url = new URL(input instanceof Request ? input.url : input);

      if (url.origin !== WORKERD_ORIGIN) return original(input, init);
      const response = await worker.fetch(
        url.href,
        input instanceof Request
          ? {
              method: input.method,
              headers: [...input.headers],
              body: input.body,
              signal: input.signal,
              duplex: "half",
            }
          : {
              method: init?.method,
              headers: [...new Headers(init?.headers)],
              body: ArrayBuffer.isView(body)
                ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
                : body,
              signal: init?.signal,
              duplex: "half",
            },
      );

      // The dispatcher's stream piped into this runtime's own; cancel and abort cross the pipe.
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();

      response.body?.pipeTo(writable).catch(() => undefined);

      return new Response(response.body === null ? null : readable, {
        status: response.status,
        headers: [...response.headers],
      });
    },

    async sessionToken(input) {
      const iat = Math.floor(Date.now() / 1000);

      return new SignJWT({
        iss: WORKERD_ISSUER,
        sub: input.userId,
        sid: input.sessionId ?? `sess_${input.userId}`,
        aud: WORKERD_ORIGIN,
        sts: "active",
        v: 2,
        iat,
        nbf: iat - 5,
        exp: iat + (input.lifetimeSeconds ?? 60),
        ...input.claims,
      })
        .setProtectedHeader({ alg: "RS256", kid: "ins_test", typ: "JWT" })
        .sign(clerkKeys.privateKey);
    },

    async query(sql, ...bindings) {
      return (
        await db
          .prepare(sql)
          .bind(...bindings)
          .all()
      ).results;
    },

    async evictRelay(environmentId, options = {}) {
      await worker.evictDurableObject("RELAY", {
        name: environmentId,
        webSockets: options.webSockets ?? "hibernate",
      });
    },

    logs: () => server.getLogs(),

    async link(input) {
      if (!clerk.users.has(input.userId))
        clerk.users.set(input.userId, {
          banned: false,
          locked: false,
          updated_at: 1,
          email: `${input.userId}@example.com`,
        });
      const key = input.key ?? (await generateMachineKey());
      const body = JSON.stringify({
        publicKey: publicKeyOf(key),
        name: input.name ?? "Studio Mac",
      });
      const response = await broker.fetch(`${WORKERD_ORIGIN}${BROKER_ROUTES.environments}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${await broker.sessionToken({ userId: input.userId })}`,
          "content-type": "application/json",
          "nyte-proof": await createProof({
            key,
            issuer: await keyThumbprint(publicKeyOf(key)),
            audience: WORKERD_ORIGIN,
            method: "POST",
            path: BROKER_ROUTES.environments,
            body,
          }),
        },
        body,
      });
      const link: unknown = await response.json();

      if (response.status !== 201 || !Value.Check(LinkResponse, link))
        throw new Error(`Linking failed with ${response.status}`);

      return { environmentId: link.environment.id, key, link };
    },

    async attach(input) {
      const desktop = new RelayDesktop(
        localUrl(`${WORKERD_ORIGIN}${BROKER_ROUTES.relay(input.environmentId)}`),
      );

      await desktop.opened();
      desktop.send({
        t: "auth",
        proof: await createProof({
          key: input.key,
          issuer: input.environmentId,
          audience: WORKERD_ORIGIN,
          method: "GET",
          path: BROKER_ROUTES.relay(input.environmentId),
          body: "",
        }),
      });
      await desktop.next("ready");

      return desktop;
    },

    async reset() {
      await db.batch(TABLES.map((table) => db.prepare(`DELETE FROM ${table}`)));
      clerk.reset();
      server.clearLogs();
    },

    async close() {
      globalThis.fetch = original;
      await server.close();
    },
  };

  return broker;
}
