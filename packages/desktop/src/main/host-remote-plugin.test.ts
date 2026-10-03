/**
 * Remote access through the built-in Cloudflare plugin, end to end on this
 * machine: the real plugin, the real listener on its fixed loopback port, and
 * a stand-in `cloudflared` that reports one connection and the dashboard's
 * routes. Status codes are read from the server, not assumed.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { afterEach, test, vi } from "vitest";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import type { MutableModels, Provider } from "@nyte-ai/ai";
import { createNyteClient } from "@nyte-ai/client";
import type { Api, Model } from "@nyte-ai/schema";
import type { HostEvent, RemoteAccessState } from "@nyte-ai/app/bridge.ts";
import { DesktopHost } from "./host.ts";
import { unusedBrowserAgent } from "./browser-stub.ts";
import { CloudflareTunnelPlugin } from "./cloudflare-tunnel.ts";

const HOSTNAME = "nyte.example.test";

const ORIGIN = `https://${HOSTNAME}`;

/** Written by the stand-in to stderr; it must never reach state, events, or errors. */
const LEAK = "cloudflared-output-that-must-stay-in-main";

const model: Model<Api> = {
  id: "echo",
  name: "Echo",
  api: "openai-responses",
  provider: "echo",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const failing: Provider["stream"] = () => {
  throw new Error("No provider in the tunnel test");
};

function localModels(): MutableModels {
  const models = createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
  });

  models.setProvider({
    id: model.provider,
    name: "Echo",
    auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
    getModels: () => [model],
    stream: failing,
    streamSimple: failing,
  });

  return models;
}

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

interface TunnelTokenFields {
  readonly a: string;
  readonly s: string;
  readonly t: string;
}

function encodeToken(body: TunnelTokenFields): string {
  return Buffer.from(JSON.stringify(body)).toString("base64");
}

/** A dashboard-shaped token: standard base64 of `{a, s, t}` with `s` itself base64. */
function tunnelToken(account = "account-fixture"): string {
  return encodeToken({ a: account, s: randomBytes(32).toString("base64"), t: randomUUID() });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  if (!Value.Check(Type.Object({ port: Type.Number() }), address)) throw new Error("no port");

  return address.port;
}

function portAccepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

interface Fixture {
  readonly root: string;
  readonly state: string;
  readonly port: number;
  readonly cloudflared: string;
}

/**
 * The stand-in reports a connection and routes for `port`, unless `gate`
 * names a file it waits for first. On SIGTERM it records whether the
 * listener's port still accepted a connection, then exits.
 */
async function fixture(options: { readonly gate?: string } = {}): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-tunnel-")));
  cleanups.push(async () => {
    await chmod(join(root, "state"), 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  const state = join(root, "state");
  await mkdir(state, { mode: 0o700 });
  const port = await freePort();

  const routes = JSON.stringify({
    ingress: [
      { hostname: HOSTNAME, service: `http://127.0.0.1:${String(port)}` },
      { service: "http_status:404" },
    ],
    "warp-routing": {},
  });

  const cloudflared = join(root, "cloudflared");
  await writeFile(
    cloudflared,
    `#!${process.execPath}
const fs = require("node:fs");
const net = require("node:net");
const root = ${JSON.stringify(root)};
fs.appendFileSync(root + "/pids", process.pid + "\\n");
process.on("SIGTERM", () => {
  const socket = net.connect(${String(port)}, "127.0.0.1");
  const done = (state) => { fs.appendFileSync(root + "/at-term", state + "\\n"); process.exit(0); };
  socket.once("connect", () => { socket.destroy(); done("open"); });
  socket.once("error", () => done("closed"));
});
const emit = (record) => process.stderr.write(JSON.stringify({ level: "info", ...record }) + "\\n");
process.stderr.write(${JSON.stringify(`${LEAK} not json\n`)});
emit({ message: "Starting tunnel", detail: ${JSON.stringify(LEAK)} });
emit({ message: "Registered tunnel connection", connIndex: 0, location: ${JSON.stringify(LEAK)} });
const routed = () => emit({ message: "Updated to new configuration", version: 1, config: ${JSON.stringify(routes)} });
const gate = ${JSON.stringify(options.gate === undefined ? null : join(root, options.gate))};
const wait = () => (gate === null || fs.existsSync(gate) ? routed() : setTimeout(wait, 10));
wait();
setInterval(() => {}, 1000);
`,
  );
  await chmod(cloudflared, 0o755);

  return { root, state, port, cloudflared };
}

async function desktop(
  setup: Fixture,
): Promise<{ readonly host: DesktopHost; readonly events: HostEvent[] }> {
  vi.stubEnv("NYTE_HOME", setup.state);
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(setup.root, "claude"));
  vi.stubEnv("CODEX_HOME", join(setup.root, "codex"));
  const appRoot = join(setup.root, "web-app");
  await mkdir(appRoot, { recursive: true });
  await writeFile(join(appRoot, "index.html"), "<!doctype html>");
  const events: HostEvent[] = [];

  const host = new DesktopHost({
    storeWorker: new URL("../../../core/src/kernel/store-worker.ts", import.meta.url),
    createModels: localModels,
    appVersion: "test",
    appRoot,
    remoteAccessPlugins: {
      cloudflare: new CloudflareTunnelPlugin({
        home: setup.state,
        cloudflared: setup.cloudflared,
        timing: {
          retryDelaysMs: [],
          ingressTimeoutMs: 5_000,
          stableMs: 60_000,
          stopTimeoutMs: 2_000,
        },
      }),
    },
    emitHostEvent: (event) => events.push(event),
    emitWatchEvent: () => undefined,
    openExternal: () => undefined,
    revealPath: () => undefined,
    showContextMenu: () => Promise.resolve(undefined),
    confirmExternal: () => Promise.resolve("cancel"),
    pickFolder: async () => undefined,
    listFonts: async () => ({ sans: [], monospace: [] }),
    browser: {
      menu: async () => undefined,
      perform: async () => undefined,
      open: () => {
        throw new Error("Browser is not used by tunnel tests");
      },
      navigate: () => undefined,
      close: () => undefined,
      captureFrame: () => Promise.resolve(undefined),
      setBounds: () => undefined,
      retain: () => undefined,
      release: () => undefined,
      warm: async () => undefined,
      releaseWindow: () => undefined,
      agent: unusedBrowserAgent(),
    },
  });

  cleanups.push(() => host.close());

  return { host, events };
}

async function configure(
  host: DesktopHost,
  setup: Fixture,
  token = tunnelToken(),
): Promise<string> {
  await host.call(1, "host.remote.configure", {
    plugin: "cloudflare",
    hostname: HOSTNAME,
    port: setup.port,
    tunnelToken: token,
  });

  return token;
}

/** Start over the tunnel and wait until the stand-in's routes are verified. */
async function serve(host: DesktopHost): Promise<void> {
  const started = await host.call(1, "host.remote.start", { reach: "cloudflare" });
  assert.equal(started.kind, "serving");
  await vi.waitFor(async () => {
    const state = await host.call(1, "host.remote.state", undefined);
    assert.equal(
      state.cloudflare.kind === "configured" && state.cloudflare.connection.kind,
      "connected",
    );
  });
}

async function pids(setup: Fixture): Promise<readonly number[]> {
  const path = join(setup.root, "pids");

  if (!existsSync(path)) return [];

  return (await readFile(path, "utf8")).trim().split("\n").map(Number);
}

async function info(
  setup: Fixture,
  headers: Record<string, string> = {},
): Promise<{ readonly status: number; readonly code: string | undefined }> {
  const response = await fetch(`http://127.0.0.1:${String(setup.port)}/v1/info`, { headers });
  const body: unknown = await response.json();

  const code = Value.Check(Type.Object({ error: Type.Object({ code: Type.String() }) }), body)
    ? body.error.code
    : undefined;

  return { status: response.status, code };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function stored(setup: Fixture): Promise<string> {
  return readFile(join(setup.state, "cloudflare-tunnel.json"), "utf8");
}

test("only paired devices get in; refusals are what the server answers, and no secret reaches the renderer", async () => {
  const setup = await fixture();
  const { host, events } = await desktop(setup);
  const secret = await configure(host, setup);
  await serve(host);

  const state = await host.call(1, "host.remote.state", undefined);
  assert.equal(state.kind === "serving" && state.address, ORIGIN);

  const anonymous = await info(setup);
  assert.deepEqual(anonymous, { status: 401, code: "unauthorized" });
  const wrong = await info(setup, bearer("x".repeat(43)));
  assert.deepEqual(wrong, { status: 403, code: "forbidden" });

  const pairing = await host.call(1, "host.remote.pair", { plugin: "cloudflare", name: "Phone" });
  assert.equal(pairing.address, ORIGIN);
  const changes = () => events.filter((event) => event.kind === "remote_access_changed").length;
  const beforeClaim = changes();

  const fromPage = await fetch(`http://127.0.0.1:${String(setup.port)}/v1/info`, {
    headers: { ...bearer(pairing.token), origin: ORIGIN },
  });

  assert.equal(fromPage.status, 200);
  assert.equal(fromPage.headers.get("access-control-allow-origin"), ORIGIN);
  // Settings hears the claim; nothing else would tell it the device stopped waiting.
  assert.equal(changes(), beforeClaim + 1);

  const foreign = await info(setup, {
    ...bearer(pairing.token),
    origin: "https://elsewhere.example",
  });

  assert.deepEqual(foreign, { status: 403, code: "forbidden" });
  assert.equal(
    (
      await createNyteClient({
        baseUrl: `http://127.0.0.1:${String(setup.port)}`,
        token: pairing.token,
      }).info()
    ).version,
    "test",
  );

  const file = await stored(setup);
  assert.equal((await stat(join(setup.state, "cloudflare-tunnel.json"))).mode & 0o777, 0o600);
  assert.equal(file.includes(pairing.token), false);
  const after = await host.call(1, "host.remote.state", undefined);
  assert.equal(after.cloudflare.kind, "configured");

  if (after.cloudflare.kind !== "configured") return;
  assert.deepEqual(
    after.cloudflare.devices.map((device) => [device.name, device.state.kind]),
    [["Phone", "paired"]],
  );

  const renderer = JSON.stringify([after, events]);

  for (const hidden of [secret, pairing.token, LEAK])
    assert.equal(renderer.includes(hidden), false);
});

test("revoking ends that device's open stream on the same port, and other devices reconnect", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  await configure(host, setup);
  await serve(host);
  const session = await host.call(1, "sessions.create", { name: "shared" });
  const baseUrl = `http://127.0.0.1:${String(setup.port)}`;

  const [first, second] = [
    await host.call(1, "host.remote.pair", { plugin: "cloudflare", name: "Revoked" }),
    await host.call(1, "host.remote.pair", { plugin: "cloudflare", name: "Kept" }),
  ];

  const revoked = createNyteClient({ baseUrl, token: first.token });
  const kept = createNyteClient({ baseUrl, token: second.token });

  const watching = (client: typeof revoked, seen: string[]) =>
    (async () => {
      for await (const event of client.watch({ sessionId: session.sessionId, live: true })) {
        seen.push(event.kind);
      }
    })().then(
      () => "ended",
      () => "ended",
    );

  const revokedSeen: string[] = [];
  const keptSeen: string[] = [];
  const revokedWatch = watching(revoked, revokedSeen);
  const keptWatch = watching(kept, keptSeen);
  await vi.waitFor(() => {
    assert.ok(revokedSeen.includes("synced"));
    assert.ok(keptSeen.includes("synced"));
  });
  const [connector] = await pids(setup);

  await host.call(1, "host.remote.revoke", { plugin: "cloudflare", deviceId: first.deviceId });

  assert.equal(await revokedWatch, "ended");
  assert.equal(await keptWatch, "ended");
  assert.deepEqual(await info(setup, bearer(first.token)), { status: 403, code: "forbidden" });
  assert.equal((await kept.info()).version, "test");
  const resumed: string[] = [];
  void watching(kept, resumed);
  await vi.waitFor(() => assert.ok(resumed.includes("synced")));

  // Same listener, same connector: the port was never released.
  assert.deepEqual(await pids(setup), [connector]);
  assert.equal(connector !== undefined && alive(connector), true);
});

test("a waiting code revoked while its first request is in flight stays revoked", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  await configure(host, setup);
  await serve(host);

  for (let round = 0; round < 5; round += 1) {
    const pairing = await host.call(1, "host.remote.pair", { plugin: "cloudflare", name: "Race" });
    await Promise.all([
      info(setup, bearer(pairing.token)).catch(() => undefined),
      host.call(1, "host.remote.revoke", { plugin: "cloudflare", deviceId: pairing.deviceId }),
    ]);
    assert.deepEqual(await info(setup, bearer(pairing.token)), { status: 403, code: "forbidden" });
  }

  assert.equal(JSON.parse(await stored(setup)).devices.length, 0);
});

test("pairing waits for a connected tunnel", async () => {
  const setup = await fixture({ gate: "routes" });
  const { host } = await desktop(setup);
  await configure(host, setup);
  await host.call(1, "host.remote.start", { reach: "cloudflare" });

  await assert.rejects(host.call(1, "host.remote.pair", { plugin: "cloudflare", name: "Early" }), {
    message: "Wait until the tunnel is connected, then add the device.",
  });
  await writeFile(join(setup.root, "routes"), "");
  await vi.waitFor(async () => {
    const pairing = await host.call(1, "host.remote.pair", { plugin: "cloudflare", name: "Later" });
    assert.equal(pairing.address, ORIGIN);
  });
});

test("paired devices outlive the desktop process: Start brings them back without pairing", async () => {
  const setup = await fixture();
  const first = await desktop(setup);
  await configure(first.host, setup);
  await serve(first.host);

  const pairing = await first.host.call(1, "host.remote.pair", {
    plugin: "cloudflare",
    name: "Phone",
  });

  assert.equal((await info(setup, bearer(pairing.token))).status, 200);
  await first.host.close();
  assert.equal(await portAccepts(setup.port), false);

  const second = await desktop(setup);
  assert.equal((await second.host.call(1, "host.remote.state", undefined)).kind, "off");
  await serve(second.host);
  assert.equal((await info(setup, bearer(pairing.token))).status, 200);
});

test("stop ends the connector while the port is still held, then releases it", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  await configure(host, setup);
  await serve(host);
  const [connector] = await pids(setup);

  await host.call(1, "host.remote.stop", undefined);

  assert.equal((await readFile(join(setup.root, "at-term"), "utf8")).trim(), "open");
  assert.equal(connector !== undefined && alive(connector), false);
  assert.equal(await portAccepts(setup.port), false);
  const state = await host.call(1, "host.remote.state", undefined);
  assert.equal(
    state.cloudflare.kind === "configured" && state.cloudflare.connection.kind,
    "stopped",
  );
});

test("a port already in use fails the start before any connector runs", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  await configure(host, setup);
  const squatter = createServer();
  await new Promise<void>((resolve) => squatter.listen(setup.port, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => squatter.close(() => resolve())));

  await assert.rejects(host.call(1, "host.remote.start", { reach: "cloudflare" }), {
    message: `Port ${String(setup.port)} is in use on this Mac. Free it, or set the tunnel up with another port.`,
  });
  assert.deepEqual(await pids(setup), []);
  assert.equal((await host.call(1, "host.remote.state", undefined)).kind, "off");
});

test("closing during startup leaves no listener and no connector", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  await configure(host, setup);

  const starting = host.call(1, "host.remote.start", { reach: "cloudflare" }).then(
    () => "started",
    () => "refused",
  );

  await host.close();
  await starting;

  assert.equal(await portAccepts(setup.port), false);

  for (const pid of await pids(setup)) await vi.waitFor(() => assert.equal(alive(pid), false));
});

test("once the settings cannot be written, no token is accepted and remote access stops", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  await configure(host, setup);
  await serve(host);
  const paired = await host.call(1, "host.remote.pair", { plugin: "cloudflare", name: "Paired" });
  assert.equal((await info(setup, bearer(paired.token))).status, 200);
  const waiting = await host.call(1, "host.remote.pair", { plugin: "cloudflare", name: "Waiting" });
  const before = await stored(setup);

  await chmod(setup.state, 0o500);
  // The waiting device's claim cannot be written, so it is refused, and so is everyone after it.
  assert.deepEqual(await info(setup, bearer(waiting.token)), { status: 403, code: "forbidden" });
  assert.deepEqual(await info(setup, bearer(paired.token)), { status: 403, code: "forbidden" });

  await assert.rejects(
    host.call(1, "host.remote.revoke", { plugin: "cloudflare", deviceId: paired.deviceId }),
    {
      message:
        "Nyte can't read or write ~/.nyte/cloudflare-tunnel.json. Fix or remove it, then restart Nyte.",
    },
  );
  const state: RemoteAccessState = await host.call(1, "host.remote.state", undefined);
  assert.equal(state.kind, "off");
  assert.deepEqual(state.cloudflare, { kind: "unavailable" });
  assert.equal(await portAccepts(setup.port), false);
  await chmod(setup.state, 0o700);
  assert.equal(await stored(setup), before);
  const leftovers = (await readdir(setup.state)).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});

test("settings are checked before saving and locked while serving; a new hostname drops devices", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);

  const invalid = (input: { hostname?: string; tunnelToken?: string }) =>
    host.call(1, "host.remote.configure", {
      plugin: "cloudflare",
      hostname: input.hostname ?? HOSTNAME,
      port: setup.port,
      tunnelToken: input.tunnelToken ?? tunnelToken(),
    });

  await assert.rejects(invalid({ hostname: "https://nyte.example.test/" }), {
    message: "Enter the public hostname alone, such as nyte.example.com.",
  });
  let padded = tunnelToken();

  for (let account = "a"; !padded.endsWith("="); account += "a") padded = tunnelToken(account);

  for (const bad of [
    "not-a-token",
    padded.replace(/=+$/u, ""),
    encodeToken({ a: "account", s: "not base64!", t: randomUUID() }),
    encodeToken({ a: "account", s: randomBytes(32).toString("base64"), t: "not-a-uuid" }),
  ]) {
    await assert.rejects(invalid({ tunnelToken: bad }), {
      message: "That isn't a tunnel token. Copy it again from the tunnel's page in Cloudflare.",
    });
  }

  assert.equal(existsSync(join(setup.state, "cloudflare-tunnel.json")), false);

  await configure(host, setup);
  await serve(host);
  await host.call(1, "host.remote.pair", { plugin: "cloudflare", name: "Phone" });
  await assert.rejects(configure(host, setup), {
    message: "Stop remote access over Cloudflare first.",
  });
  await host.call(1, "host.remote.stop", undefined);

  await configure(host, setup);
  assert.equal(JSON.parse(await stored(setup)).devices.length, 1);
  await host.call(1, "host.remote.configure", {
    plugin: "cloudflare",
    hostname: "other.example.test",
    port: setup.port,
    tunnelToken: tunnelToken(),
  });
  assert.equal(JSON.parse(await stored(setup)).devices.length, 0);
  await host.call(1, "host.remote.clear", { plugin: "cloudflare" });
  assert.equal(existsSync(join(setup.state, "cloudflare-tunnel.json")), false);
});
