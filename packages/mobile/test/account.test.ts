import { createHash, randomBytes } from "node:crypto";
import { createBrokerClient } from "@nyte-ai/connect";
import type { EnvironmentSummary } from "@nyte-ai/connect";
import type { ServerInfo } from "@nyte-ai/protocol";
import { describe, expect, it, vi } from "vitest";
import { parseAccountConfig } from "../src/account/account-config.ts";
import { brokerCopy, connectEndingCopy, releaseCopy } from "../src/account/account-copy.ts";
import {
  connectEnvironment,
  createDeviceSecret,
  type DeviceCrypto,
} from "../src/account/enrollment.ts";
import { releaseDevice, releaseOnHost } from "../src/account/revocation.ts";
import { createConnectionStore } from "../src/connection/connection-store.ts";
import { serializeConnection, type ManagedConnection } from "../src/connection/connection.ts";

const ORIGIN = "https://connect.example.com";
const JWT = "clerk.session.jwt";
const OWNER = "user_owner";
const DEVICE_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const POLICY = { origin: ORIGIN };

const MAC: EnvironmentSummary = {
  id: "0b8c9f3e-5d7a-4c1b-9e2f-3a4b5c6d7e8f",
  name: "Studio Mac",
  online: true,
  lastSeenAt: 1,
};

const MAC_URL = `${ORIGIN}/r/${MAC.id}`;

/** Broker and relay share one origin; only the path tells them apart. */
const toBroker = (request: Seen) => request.url.startsWith(`${ORIGIN}/v1/`);

const INFO: ServerInfo = { version: "test", wireVersion: 1, host: { kind: "unspecified" } };

const nodeCrypto: DeviceCrypto = {
  randomBytes: async (count) => new Uint8Array(randomBytes(count)),
  sha256Base64: async (text) => createHash("sha256").update(text, "utf8").digest("base64"),
};

const sha256Url = (text: string) => createHash("sha256").update(text, "utf8").digest("base64url");

const key = (host: string) => `pk_test_${btoa(host)}`;

type Seen = {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly credentials: RequestCredentials | undefined;
  readonly body: string | undefined;
};

/**
 * The broker and the relayed Mac behind one fetch. Each route answers from
 * the scenario, and every request is recorded as it went on the wire.
 */
function network(scenario: {
  readonly enroll?: (body: unknown) => Response | Promise<Response>;
  readonly info?: (attempt: number) => Response;
  readonly release?: () => Response;
  readonly revoke?: () => Response;
}) {
  const seen: Seen[] = [];
  let infos = 0;

  const fetch = async (...[resource, init]: Parameters<typeof globalThis.fetch>) => {
    const url =
      typeof resource === "string"
        ? resource
        : resource instanceof URL
          ? resource.href
          : resource.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    seen.push({
      method,
      url,
      authorization: new Headers(init?.headers).get("authorization"),
      credentials: init?.credentials,
      body,
    });
    const { pathname, origin } = new URL(url);

    if (origin !== ORIGIN) return new Response(null, { status: 404 });

    if (method === "POST" && pathname === `/v1/environments/${MAC.id}/devices`)
      return (
        scenario.enroll?.(JSON.parse(body ?? "null")) ??
        Response.json({ environmentId: MAC.id, deviceId: DEVICE_ID }, { status: 201 })
      );

    if (method === "DELETE" && pathname.startsWith("/v1/environments/"))
      return scenario.revoke?.() ?? new Response(null, { status: 204 });

    const relayed = /^\/r\/[0-9a-f-]{36}(\/.*)$/u.exec(pathname)?.[1];

    if (relayed === "/v1/info") {
      infos += 1;

      return scenario.info?.(infos) ?? Response.json({ ok: true, defined: true, value: INFO });
    }

    if (relayed === "/_nyte/connect/device" && method === "DELETE")
      return scenario.release?.() ?? new Response(null, { status: 204 });

    return new Response(null, { status: 404 });
  };

  return { fetch, seen };
}

const refusal = (status: number, code: string) =>
  Response.json({ ok: false, error: { code, message: "no" } }, { status });

function memory(initial: string | null = null) {
  let text = initial;

  return {
    storage: {
      read: async () => text,
      write: async (next: string) => {
        text = next;
      },
      remove: async () => {
        text = null;
      },
    },
    current: () => text,
  };
}

function broker(fetch: ReturnType<typeof network>["fetch"]) {
  return createBrokerClient({ origin: ORIGIN, sessionToken: async () => JWT, fetch });
}

function enrollment(input: {
  readonly net: ReturnType<typeof network>;
  readonly store: ReturnType<typeof createConnectionStore>;
  readonly signal?: AbortSignal;
  readonly windowMs?: number;
}) {
  return connectEnvironment({
    broker: broker(input.net.fetch),
    environment: MAC,
    origin: ORIGIN,
    ownerId: OWNER,
    clientId: "client_abcdefghijklmnop",
    clientName: "iPhone",
    crypto: nodeCrypto,
    fetch: input.net.fetch,
    save: input.store.save,
    signal: input.signal ?? new AbortController().signal,
    readiness: { windowMs: input.windowMs ?? 2_000, intervalMs: 5 },
  });
}

describe("parseAccountConfig", () => {
  const valid = { publishableKey: key("clerk.example.com$"), origin: ORIGIN };

  it("turns the account on only when both values are present and valid", () => {
    expect(parseAccountConfig(valid)).toEqual(valid);
    expect(parseAccountConfig({ ...valid, publishableKey: undefined })).toBeUndefined();
    expect(parseAccountConfig({ ...valid, origin: undefined })).toBeUndefined();
  });

  it("refuses a broker origin that is not a canonical HTTPS origin", () => {
    for (const origin of [
      "http://connect.example.com",
      "https://connect.example.com/",
      "https://connect.example.com/v1",
      "https://user:pass@connect.example.com",
      "https://connect.example.com?x=1",
      "https://connect.example.com#x",
    ])
      expect(parseAccountConfig({ ...valid, origin })).toBeUndefined();
  });

  it("refuses publishable keys ClerkProvider would throw on", () => {
    for (const publishableKey of [
      "pk_test_",
      "sk_test_" + btoa("clerk.example.com$"),
      "pk_test_abc",
      key("clerk.example.com"),
      key("https://clerk.example.com$"),
      key("clerk$example.com$"),
      key("localhost$"),
      key("clerk.example.com:443$"),
      `pk_test_${btoa("clerk.example.com$").replace("=", "_")}_`,
    ])
      expect(parseAccountConfig({ ...valid, publishableKey })).toBeUndefined();
  });
});

describe("createDeviceSecret", () => {
  it("encodes 32 CSPRNG bytes and hashes the token's UTF-8 text", async () => {
    const secret = await createDeviceSecret({
      ...nodeCrypto,
      randomBytes: async (count) => new Uint8Array(count),
    });

    expect(secret.token).toBe("A".repeat(43));
    expect(secret.digest).toBe(sha256Url(secret.token));
    expect(secret.digest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it("refuses a random source that returns the wrong length", async () => {
    await expect(
      createDeviceSecret({ ...nodeCrypto, randomBytes: async () => new Uint8Array(16) }),
    ).rejects.toThrow(/wrong number of bytes/u);
  });
});

describe("connectEnvironment", () => {
  it("sends the broker only a digest and gives the bearer to the picked Mac alone", async () => {
    const net = network({
      info: (attempt) =>
        attempt < 3
          ? refusal(401, "unauthorized")
          : Response.json({ ok: true, defined: true, value: INFO }),
    });
    const disk = memory();
    const store = createConnectionStore(disk.storage, POLICY);

    expect(await enrollment({ net, store })).toEqual({ kind: "connected" });

    const snapshot = store.getSnapshot();

    if (snapshot.kind !== "saved" || snapshot.saved.kind !== "managed")
      throw new Error("expected a saved account connection");
    const { connection, binding } = snapshot.saved;

    expect(connection).toMatchObject({ name: MAC.name, url: MAC_URL });
    expect(binding).toEqual({
      origin: ORIGIN,
      environmentId: MAC.id,
      deviceId: DEVICE_ID,
      ownerId: OWNER,
    });

    const enrolls = net.seen.filter(toBroker);
    expect(enrolls).toHaveLength(1);
    expect(JSON.parse(enrolls[0]?.body ?? "null")).toEqual({
      clientId: "client_abcdefghijklmnop",
      clientName: "iPhone",
      digest: sha256Url(connection.token),
    });
    expect(enrolls[0]?.body).not.toContain(connection.token);

    // The readiness window retried the same bearer at the relay. On the shared
    // origin the JWT goes only to the broker and the bearer only to the Mac.
    expect(net.seen.filter((request) => request.url === `${MAC_URL}/v1/info`)).toHaveLength(3);

    for (const request of net.seen) {
      expect(request.authorization).toBe(
        toBroker(request) ? `Bearer ${JWT}` : `Bearer ${connection.token}`,
      );
      expect(request.credentials).toBe("omit");
      expect(request.url).not.toContain(connection.token);
    }
    expect(disk.current()).toContain(connection.token);
  });

  it("refuses an answer for another Mac before the bearer goes anywhere", async () => {
    const net = network({
      enroll: () =>
        Response.json(
          { environmentId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", deviceId: DEVICE_ID },
          { status: 201 },
        ),
    });
    const disk = memory();

    expect(await enrollment({ net, store: createConnectionStore(disk.storage, POLICY) })).toEqual({
      kind: "broker",
      failure: { kind: "bad_response", status: 201 },
    });
    expect(net.seen).toHaveLength(1);
    expect(disk.current()).toBeNull();
  });

  it("reaches the Mac only at this broker's relay, whatever the answer names", async () => {
    const net = network({
      enroll: () =>
        Response.json(
          { environmentId: MAC.id, deviceId: DEVICE_ID, address: "https://mac.attacker.example" },
          { status: 201 },
        ),
    });

    expect(
      await enrollment({ net, store: createConnectionStore(memory().storage, POLICY) }),
    ).toEqual({ kind: "connected" });
    expect(net.seen.every((request) => request.url.startsWith(`${ORIGIN}/`))).toBe(true);
  });

  it("keeps retrying one bearer through the window, never enrolls again, then releases it", async () => {
    const net = network({ info: () => refusal(403, "forbidden") });
    const disk = memory();
    const store = createConnectionStore(disk.storage, POLICY);

    expect(await enrollment({ net, store, windowMs: 60 })).toEqual({ kind: "notAccepted" });
    await vi.waitFor(() =>
      expect(net.seen.some((request) => request.url.endsWith("/_nyte/connect/device"))).toBe(true),
    );

    const enrolls = net.seen.filter(toBroker);
    const bearers = new Set(
      net.seen.filter((request) => !toBroker(request)).map((r) => r.authorization),
    );
    expect(enrolls).toHaveLength(1);
    expect(bearers.size).toBe(1);
    expect(disk.current()).toBeNull();
    expect(connectEndingCopy({ kind: "notAccepted" }).action).toBe("retry");
  });

  it("releases the replaced Mac's bearer on that Mac alone, never through the broker", async () => {
    const office: ManagedConnection = {
      kind: "managed",
      connection: {
        name: "Office Mac",
        url: `${ORIGIN}/r/1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f`,
        token: "office-bearer",
      },
      binding: {
        origin: ORIGIN,
        environmentId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
        deviceId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
        ownerId: OWNER,
      },
    };
    const net = network({});
    const store = createConnectionStore(memory(serializeConnection(office)).storage, POLICY);

    expect(await enrollment({ net, store })).toEqual({ kind: "connected" });
    await vi.waitFor(() =>
      expect(net.seen.filter((request) => request.method === "DELETE")).toEqual([
        {
          method: "DELETE",
          url: `${office.connection.url}/_nyte/connect/device`,
          authorization: "Bearer office-bearer",
          credentials: "omit",
          body: undefined,
        },
      ]),
    );
  });

  it("saves nothing when the account changes after the Mac accepted", async () => {
    const previous = JSON.stringify({ name: "Laptop", url: "http://127.0.0.1:1", token: "manual" });
    const disk = memory(previous);
    const store = createConnectionStore(disk.storage, POLICY);
    const accountChange = new AbortController();
    const net = network({
      info: () => {
        accountChange.abort();

        return Response.json({ ok: true, defined: true, value: INFO });
      },
    });

    expect(await enrollment({ net, store, signal: accountChange.signal })).toEqual({
      kind: "cancelled",
    });
    expect(disk.current()).toBe(previous);
    await vi.waitFor(() =>
      expect(net.seen.some((request) => request.url.endsWith("/_nyte/connect/device"))).toBe(true),
    );
  });

  it("names a revoked session as a sign-in problem, not a network one", async () => {
    const net = network({
      enroll: () =>
        Response.json({ error: { code: "session_revoked", message: "revoked" } }, { status: 401 }),
    });
    const ending = await enrollment({
      net,
      store: createConnectionStore(memory().storage, POLICY),
    });

    expect(ending).toEqual({
      kind: "broker",
      failure: { kind: "refused", status: 401, code: "session_revoked" },
    });
    expect(brokerCopy({ kind: "refused", status: 401, code: "owner_disabled" }).action).toBe(
      "signIn",
    );
    expect(brokerCopy({ kind: "refused", status: 502, code: "unreachable" }).body).toMatch(
      /awake with Nyte open/u,
    );
  });
});

describe("releaseDevice", () => {
  const saved: ManagedConnection = {
    kind: "managed",
    connection: { name: MAC.name, url: MAC_URL, token: "device-bearer" },
    binding: { origin: ORIGIN, environmentId: MAC.id, deviceId: DEVICE_ID, ownerId: OWNER },
  };

  it("revokes through the broker first, then asks the Mac with the device's own bearer", async () => {
    const net = network({});
    const report = await releaseDevice({
      saved,
      broker: broker(net.fetch),
      fetch: net.fetch,
      timeoutMs: 1_000,
    });

    expect(report).toEqual({ host: "removed", broker: "removed" });
    expect(net.seen.map((request) => [request.method, request.url, request.authorization])).toEqual(
      [
        ["DELETE", `${ORIGIN}/v1/environments/${MAC.id}/devices/${DEVICE_ID}`, `Bearer ${JWT}`],
        ["DELETE", `${MAC_URL}/_nyte/connect/device`, "Bearer device-bearer"],
      ],
    );
  });

  it("counts 204, 401, and 403 from the Mac as gone, and no other answer", async () => {
    const answers = [
      [204, "removed"],
      [401, "removed"],
      [403, "removed"],
      [200, "unconfirmed"],
      [202, "unconfirmed"],
      [404, "unconfirmed"],
      [502, "unconfirmed"],
      [503, "unconfirmed"],
    ] as const;

    for (const [status, expected] of answers) {
      const net = network({ release: () => new Response(null, { status }) });

      expect(
        await releaseOnHost({ connection: saved.connection, fetch: net.fetch, timeoutMs: 1_000 }),
        String(status),
      ).toBe(expected);
    }
  });

  it("still asks the Mac when the broker fails, and claims only what answered", async () => {
    const net = network({
      revoke: () => Response.json({ error: { code: "internal", message: "no" } }, { status: 500 }),
      release: () => refusal(401, "unauthorized"),
    });
    const report = await releaseDevice({
      saved,
      broker: broker(net.fetch),
      fetch: net.fetch,
      timeoutMs: 1_000,
    });

    expect(report).toEqual({ host: "removed", broker: "unconfirmed" });
    expect(releaseCopy(MAC.name, report)).toBe(`${MAC.name} removed this iPhone.`);
    expect(releaseCopy(MAC.name, { host: "unconfirmed", broker: "removed" })).toMatch(
      /within a minute/u,
    );
  });

  it("reports silence as unconfirmed within its bound", async () => {
    const hanging = async (...[, init]: Parameters<typeof globalThis.fetch>): Promise<Response> =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    const started = Date.now();
    const report = await releaseDevice({
      saved,
      broker: broker(hanging),
      fetch: hanging,
      timeoutMs: 30,
    });

    expect(report).toEqual({ host: "unconfirmed", broker: "unconfirmed" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(releaseCopy(MAC.name, report)).not.toMatch(/removed|stops/u);
  });
});
