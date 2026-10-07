import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrokerClient, EnrollRequest } from "@nyte-ai/connect";
import type { DeviceRole } from "@nyte-ai/connect";
import { openProfile } from "@nyte-ai/host/runtime";
import type { HostProfile } from "@nyte-ai/host/runtime";
import type { ServerInfo } from "@nyte-ai/protocol";
import { Value } from "typebox/value";
import { afterEach, beforeEach, describe, test, vi } from "vitest";
import { connectAccountEnvironment } from "./account-connection.ts";
import { loadAccountDevice } from "./account-device.ts";
import { createWebBridge } from "./bridge.ts";
import { connectPinned } from "./pins.ts";
import type { PinRoute } from "./pins.ts";

function memoryStorage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const cleanups: (() => Promise<void>)[] = [];

async function profile(name: string): Promise<HostProfile> {
  const root = await mkdtemp(join(tmpdir(), "nyte-web-pairing-"));
  const opened = await openProfile(name, root);
  cleanups.push(async () => {
    await opened.release();
    await rm(root, { recursive: true, force: true });
  });

  return opened;
}

/**
 * Whoever answers every address right now: a registry host that announces one
 * profile's identity and signs with another's key, or nobody. The broker
 * records each enrollment request; the relay records each device release.
 */
interface Network {
  host: { readonly announces: HostProfile; readonly signs: HostProfile } | undefined;
  readonly roles: (DeviceRole | undefined)[];
  readonly released: string[];
}

const ENVIRONMENT = "c87081d0-9697-40b7-98bd-7f655e6013ea";

function serve(network: Network): void {
  vi.stubGlobal("fetch", async (resource: string | URL | Request, init?: RequestInit) => {
    const request = new Request(resource, init);
    const url = new URL(request.url);

    if (url.pathname.endsWith("/devices") && request.method === "POST") {
      const body: unknown = await request.json();
      assert.ok(Value.Check(EnrollRequest, body));
      network.roles.push(body.role);

      return Response.json({ environmentId: ENVIRONMENT, deviceId: crypto.randomUUID() });
    }

    if (url.pathname.endsWith("/_nyte/connect/device")) {
      network.released.push(request.headers.get("authorization") ?? "");

      return new Response(null, { status: 204 });
    }

    const { host } = network;

    if (host === undefined) throw new TypeError("Failed to fetch");

    if (url.pathname.endsWith("/v1/identity"))
      return Response.json({
        ok: true,
        defined: true,
        value: host.signs.sign(url.searchParams.get("nonce") ?? ""),
      });

    if (url.pathname.endsWith("/v1/info")) {
      const info = {
        version: "0.0.0",
        wireVersion: 1,
        environment: true,
        identity: { hostId: host.announces.hostId, publicKey: host.announces.publicKey },
        workspaces: { kind: "registry" },
        host: { kind: "unspecified" },
      } satisfies ServerInfo;

      return Response.json({ ok: true, defined: true, value: info });
    }

    return Response.json({ ok: true, defined: true, value: [] });
  });
}

beforeEach(() => {
  vi.stubGlobal("document", { visibilityState: "hidden", addEventListener: () => undefined });
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(async () => {
  vi.unstubAllGlobals();

  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const connection = { url: "https://host.test", token: "t" };

const address: PinRoute = { kind: "address", url: connection.url };

describe("an address's pin", () => {
  test("is made only from an identity the host signs for, and nothing is adopted before", async () => {
    const [host, other] = [await profile("host"), await profile("other")];
    const network: Network = { host: { announces: host, signs: other }, roles: [], released: [] };
    serve(network);
    const storage = memoryStorage();
    const web = createWebBridge();

    const pair = () =>
      connectPinned({ bridge: web, storage, route: address, connection, repair: false });

    await assert.rejects(pair(), { name: "IdentityChanged" });
    assert.equal(web.bridge.host.starts, undefined);

    network.host = { announces: host, signs: host };
    assert.equal((await pair()).identity?.hostId, host.hostId);
    assert.notEqual(web.bridge.host.starts, undefined);

    // Pinned now: the announcing host may not swap its key.
    network.host = { announces: other, signs: other };
    await assert.rejects(pair(), { name: "IdentityChanged" });
  });

  test("survives ordinary retries and a failed re-pair; only a re-pair that proves a host replaces it", async () => {
    const [first, second] = [await profile("first"), await profile("second")];
    const network: Network = { host: { announces: first, signs: first }, roles: [], released: [] };
    serve(network);
    const storage = memoryStorage();
    const web = createWebBridge();

    const connect = (repair: boolean) =>
      connectPinned({ bridge: web, storage, route: address, connection, repair });

    await connect(false);
    network.host = { announces: second, signs: second };
    await assert.rejects(connect(false), { name: "IdentityChanged" });
    await assert.rejects(connect(false), { name: "IdentityChanged" });

    network.host = undefined;
    await assert.rejects(connect(true), { name: "NyteTransportError" });
    network.host = { announces: second, signs: second };
    await assert.rejects(connect(false), { name: "IdentityChanged" });

    await connect(true);
    await connect(false);
    network.host = { announces: first, signs: first };
    await assert.rejects(connect(false), { name: "IdentityChanged" });
  });

  test("belongs to its own route", async () => {
    const [first, second] = [await profile("first"), await profile("second")];
    serve({ host: { announces: first, signs: first }, roles: [], released: [] });
    const storage = memoryStorage();
    const web = createWebBridge();

    const route = (ownerId: string): PinRoute => ({
      kind: "account",
      origin: "https://connect.test",
      ownerId,
      environmentId: ENVIRONMENT,
    });

    await connectPinned({
      bridge: web,
      storage,
      route: route("user_one"),
      connection,
      repair: false,
    });
    serve({ host: { announces: second, signs: second }, roles: [], released: [] });
    await connectPinned({
      bridge: web,
      storage,
      route: route("user_two"),
      connection,
      repair: false,
    });
    await connectPinned({ bridge: web, storage, route: address, connection, repair: false });
    await assert.rejects(
      connectPinned({ bridge: web, storage, route: route("user_one"), connection, repair: false }),
      { name: "IdentityChanged" },
    );
  });
});

describe("account enrollment", () => {
  const config = {
    publishableKey: `pk_test_${btoa("clerk.example.com$")}`,
    origin: "https://connect.test",
  };

  const environment = { id: ENVIRONMENT, name: "Studio", online: true, lastSeenAt: null };

  function enroll(network: Network, role: DeviceRole, repair: boolean) {
    serve(network);

    return connectAccountEnvironment({
      broker: createBrokerClient({ origin: config.origin, sessionToken: async () => "session" }),
      config,
      ownerId: "user_one",
      environment,
      role,
      repair,
      signal: new AbortController().signal,
    });
  }

  test("the broker is asked for the role the owner picked", async () => {
    const host = await profile("host");
    const network: Network = { host: { announces: host, signs: host }, roles: [], released: [] };

    await enroll(network, "owner", false);
    await enroll(network, "controller", false);
    assert.deepEqual(network.roles, ["owner", "controller"]);
  });

  test("a host that cannot prove the environment's pin keeps no device and leaves the pin", async () => {
    const [host, other] = [await profile("host"), await profile("other")];
    const network: Network = { host: { announces: host, signs: host }, roles: [], released: [] };
    const kept = await enroll(network, "owner", false);

    network.host = { announces: other, signs: other };
    await assert.rejects(enroll(network, "owner", false), { name: "IdentityChanged" });
    assert.equal(network.released.length, 1);
    assert.equal(loadAccountDevice(sessionStorage, config, "user_one")?.deviceId, kept?.deviceId);

    network.host = { announces: host, signs: host };
    await enroll(network, "controller", false);

    network.host = { announces: other, signs: other };
    await enroll(network, "owner", true);
    await enroll(network, "owner", false);
  });
});
