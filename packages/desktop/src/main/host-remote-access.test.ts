import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { sdk } from "@nyte-ai/sdk";
import type { Connection } from "@nyte-ai/sdk";
import { testDesktop } from "./fixtures/desktop-host.ts";
import type { TestDesktop } from "./fixtures/desktop-host.ts";

const opened: TestDesktop[] = [];

const connections: Connection[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.close();

  for (const desktop of opened.splice(0)) await desktop.close();
});

async function serving(): Promise<{
  readonly made: TestDesktop;
  readonly address: string;
  readonly token: string;
}> {
  const made = await testDesktop();
  opened.push(made);
  const state = await made.host.call(1, "host.remote.start", { reach: "local" });

  if (state.kind !== "serving" || state.reach === "cloudflare")
    throw new Error("Remote access did not start on loopback");

  return { made, address: state.address, token: state.token };
}

test("a client on the remote address reads and drives the desktop's own host", async () => {
  const { made, address, token } = await serving();
  const host = await made.host.host();
  const mine = await host.sessions.create({ name: "from the Mac" });

  const connection = await sdk.connect({
    url: address,
    credentials: { kind: "token", token },
    expect: { hostId: host.hostId },
  });

  connections.push(connection);
  const { items } = await connection.sessions.list();

  assert.ok(items.some((session) => session.id === mine.sessionId));
  const theirs = await connection.sessions.create({ name: "from the phone" });
  assert.ok((await host.sessions.list()).items.some((session) => session.id === theirs.sessionId));
});

test("the pairing link carries the address and token in its fragment only", async () => {
  const { made, address, token } = await serving();
  const state = await made.host.call(1, "host.remote.state", undefined);

  if (state.kind !== "serving" || state.reach === "cloudflare")
    throw new Error("Remote access is not serving a token");
  const link = new URL(state.pairingUrl);

  assert.equal(link.search, "");
  assert.equal(new URLSearchParams(link.hash.slice(1)).get("host"), address);
  assert.equal(new URLSearchParams(link.hash.slice(1)).get("token"), token);
});

test("a missing or wrong token is refused", async () => {
  const { address } = await serving();

  await assert.rejects(
    sdk.connect({ url: address, credentials: { kind: "token", token: "z".repeat(43) } }),
    { code: "unauthenticated" },
  );

  const anonymous = await fetch(`${address}/sessions.list`, {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json" },
  });

  assert.equal(anonymous.status, 401);
});

test("stopping closes the listener while the desktop keeps its own", async () => {
  const { made, address } = await serving();
  const local = await made.host.call(1, "host.endpoint", undefined);

  await made.host.call(1, "host.remote.stop", undefined);

  await assert.rejects(fetch(`${address}/sessions.list`, { method: "POST", body: "{}" }));
  assert.equal((await made.host.call(1, "host.remote.state", undefined)).kind, "off");
  const connection = await sdk.connect(local);
  connections.push(connection);
  assert.equal(connection.hostId, local.expect?.hostId);
  assert.ok(made.events.some((event) => event.kind === "remote_access_changed"));
});
