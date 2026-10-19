/**
 * A link's life: linking, cancelling, unlinking, the relay being revoked or
 * taken over, waking, restarts, and the build configuration. See
 * `fixtures/connect-machine.ts`.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { BROKER_ROUTES } from "@nyte-ai/connect";
import { RELAY_CLOSE } from "@nyte-ai/connect/relay";
import { PrivateJwk, keyThumbprint } from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import { readConnectConfig } from "./connect-config.ts";
import {
  cleanUp,
  ORIGIN,
  sessionJwt,
  CONFIG,
  fixture,
  sleep,
  desktop,
  view,
  linked,
  serve,
  info,
  watch,
  relayGone,
  stored,
  denied,
  allowed,
} from "./fixtures/connect-machine.ts";

afterEach(cleanUp);

test("cancel, disable, and quit win over work still in flight", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  const { broker, account } = setup;
  const { host } = desktop_;

  account.hold = true;
  const waiting = host.call(1, "host.connect.link", undefined);
  await vi.waitFor(async () => {
    const current = await view(host);
    assert.ok(current.kind === "unlinked" && current.linking.kind === "waiting_for_account");
  });
  await host.call(1, "host.connect.cancel", undefined);
  const cancelled = await waiting;
  assert.ok(cancelled.kind === "unlinked");
  assert.deepEqual(cancelled.linking, { kind: "failed", reason: "cancelled" });
  assert.equal(broker.count(`POST ${BROKER_ROUTES.environments}`), 0);

  account.hold = false;
  const gate = Promise.withResolvers<void>();
  broker.linkGate = gate.promise;
  const inFlight = host.call(1, "host.connect.link", undefined);
  await vi.waitFor(() => assert.equal(broker.count(`POST ${BROKER_ROUTES.environments}`), 1));
  await host.call(1, "host.connect.cancel", undefined);
  gate.resolve();
  assert.equal(
    (await inFlight).kind,
    "unlinked",
    "cancelled while the broker answers: nothing links",
  );
  const firstEnvironment = broker.env?.id;
  broker.linkGate = undefined;
  assert.equal((await host.call(1, "host.connect.link", undefined)).kind, "linked");
  assert.equal(broker.env?.id, firstEnvironment, "the next try resumes the same environment");

  const [on, off] = await Promise.allSettled([
    host.call(1, "host.connect.setEnabled", { enabled: true }),
    host.call(1, "host.connect.setEnabled", { enabled: false }),
  ]);

  assert.equal(on.status, "fulfilled");
  assert.equal(off.status, "fulfilled");
  const settled = await linked(host);
  assert.equal(settled.enabled, false, "on and off at once: off wins");
  assert.deepEqual(settled.lease, { kind: "stopped" });
  assert.deepEqual(settled.connection, { kind: "stopped" }, "and nothing is left running");
  await relayGone(setup);

  const turning = host.call(1, "host.connect.setEnabled", { enabled: true }).catch(() => undefined);
  await host.close();
  await turning;
  await relayGone(setup);
  assert.equal(
    JSON.parse(await stored(setup)).link.environment.id,
    firstEnvironment,
    "quitting is not unlinking",
  );
  assert.equal(account.closed, 1);
});

test("a tombstoned key from an abandoned link is replaced, not retried forever", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  const { broker } = setup;
  const gate = Promise.withResolvers<void>();
  broker.linkGate = gate.promise;
  const abandoned = host.call(1, "host.connect.link", undefined);
  await vi.waitFor(() => assert.ok(broker.env));
  await host.call(1, "host.connect.cancel", undefined);
  gate.resolve();
  await abandoned;
  broker.linkGate = undefined;
  assert.ok(broker.env);
  broker.revokedKeys.add(broker.env.thumbprint);

  const refused = await host.call(1, "host.connect.link", undefined);
  assert.ok(refused.kind === "unlinked" && refused.linking.kind === "failed");
  assert.equal(JSON.parse(await stored(setup)).linkKey, null);
  const relinked = await host.call(1, "host.connect.link", undefined);
  assert.equal(relinked.kind, "linked");
  assert.equal(broker.env.removed, false);
  assert.notEqual(broker.env.thumbprint, [...broker.revokedKeys][0]);
});

test("a link another account began is not resumed under this one", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  const { broker, account } = setup;
  const gate = Promise.withResolvers<void>();
  broker.linkGate = gate.promise;
  const abandoned = host.call(1, "host.connect.link", undefined);
  await vi.waitFor(() => assert.ok(broker.env));
  await host.call(1, "host.connect.cancel", undefined);
  gate.resolve();
  await abandoned;
  broker.linkGate = undefined;
  const first = broker.env;
  assert.ok(first);

  account.token = sessionJwt("user_other");
  broker.sessions.add(account.token);
  assert.equal((await host.call(1, "host.connect.link", undefined)).kind, "linked");
  assert.notEqual(broker.env?.thumbprint, first.thumbprint);
});

test("full removal queues refuse new links and enrollments instead of dropping what is pending", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;

  const queued = async (): Promise<readonly string[]> =>
    JSON.parse(await stored(setup)).link.revocations.map((entry: { kind: string }) => entry.kind);

  broker.offline = true;
  let refusedAt: number | undefined;

  for (let round = 0; refusedAt === undefined && round < 80; round += 1) {
    const token = randomBytes(32).toString("base64url");
    const grant = await broker.grant({ token });
    const answer = await broker.enroll(grant.authorization, grant.deviceId, { activate: false });

    if (answer.status === 429) refusedAt = round;
    else await desktop_.host.call(1, "host.connect.revokeDevice", { deviceId: grant.deviceId });
  }

  assert.equal(refusedAt, 64, "the broker cannot be told, so every removed device stays queued");
  assert.deepEqual(
    await queued(),
    Array.from({ length: 64 }, () => "revoke"),
  );

  broker.offline = false;
  await desktop_.host.call(1, "host.connect.revokeDevice", { deviceId: randomUUID() });
  await vi.waitFor(async () => assert.deepEqual(await queued(), []), { timeout: 10_000 });
  assert.equal(broker.count(`DELETE ${BROKER_ROUTES.devices(broker.env?.id ?? "")}`), 0);
  const phone = await broker.phone();
  assert.deepEqual(await info(setup, phone.token), allowed);
}, 60_000);

test("pending unlinks are kept until the broker confirms them, and a full queue holds new links back", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  const { broker, account } = setup;
  broker.removalOffline = true;
  const removed: string[] = [];

  for (let round = 0; round < 8; round += 1) {
    assert.equal((await host.call(1, "host.connect.link", undefined)).kind, "linked");
    removed.push(broker.env?.id ?? "");
    await host.call(1, "host.connect.unlink", undefined);
  }

  const pending = async (): Promise<readonly string[]> =>
    JSON.parse(await stored(setup)).unlinks.map(
      (entry: { environmentId: string }) => entry.environmentId,
    );

  assert.deepEqual(await pending(), removed);

  const requests = account.requests;
  const held = await host.call(1, "host.connect.link", undefined);
  assert.ok(held.kind === "unlinked" && held.linking.kind === "failed");
  assert.equal(account.requests, requests);
  assert.deepEqual(await pending(), removed);

  broker.removalOffline = false;
  assert.equal((await host.call(1, "host.connect.link", undefined)).kind, "linked");
  assert.deepEqual(await pending(), []);
}, 30_000);

test("a linked Mac keeps serving with its machine key when the sign-in dialog is unavailable", async () => {
  const setup = await fixture();
  const first = await desktop(setup);
  await serve(first);
  const phone = await setup.broker.phone();
  await first.host.close();

  const second = await desktop(setup, { account: undefined });
  second.host.autostartConnect();
  await vi.waitFor(async () => assert.deepEqual(await info(setup, phone.token), allowed));
  const current = await linked(second.host);
  assert.deepEqual(current.account, { kind: "unavailable" });
  await assert.rejects(
    second.host
      .call(1, "host.connect.unlink", undefined)
      .then(() => second.host.call(1, "host.connect.link", undefined)),
  );
});

test("serving outlives the window that turned it on", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const phone = await setup.broker.phone();

  desktop_.host.releaseWindow(1);
  assert.deepEqual(await info(setup, phone.token), allowed);
  assert.equal((await linked(desktop_.host)).connection.kind, "connected");
});

test("unlink refuses at once, closes the relay, and retries the broker on a later run", async () => {
  const setup = await fixture();
  const first = await desktop(setup);
  const serving = await serve(first);
  const { broker } = setup;
  const phone = await broker.phone();

  broker.offline = true;
  await first.host.call(1, "host.connect.unlink", undefined);
  const after = await view(first.host);
  assert.ok(after.kind === "unlinked");
  assert.deepEqual(after.notice, { kind: "unlink_pending" });
  await relayGone(setup);
  const file = JSON.parse(await stored(setup));
  assert.equal(file.link, null);
  assert.equal(file.enabled, false);
  assert.deepEqual(
    file.unlinks.map((entry: { environmentId: string }) => entry.environmentId),
    [serving.environment.id],
  );
  assert.equal(JSON.stringify(file).includes(phone.deviceId), false);
  await first.host.close();

  broker.offline = false;
  const second = await desktop(setup);
  second.host.autostartConnect();
  await vi.waitFor(async () => {
    const current = await view(second.host);
    assert.ok(current.kind === "unlinked" && current.notice.kind === "none");
  });
  assert.equal(broker.env?.removed, true);
  assert.deepEqual(JSON.parse(await stored(setup)).unlinks, []);
});

test("a removed environment is forgotten; a disabled owner only lapses", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const phone = await broker.phone();

  broker.leaseMode = "owner_disabled";
  await vi.waitFor(async () =>
    assert.deepEqual((await linked(desktop_.host)).lease, {
      kind: "lapsed",
      reason: "owner_disabled",
    }),
  );
  assert.deepEqual(await info(setup, phone.token), denied);
  assert.equal(setup.relay.connected(), broker.env?.id);
  broker.leaseMode = "ok";
  await vi.waitFor(async () => assert.deepEqual(await info(setup, phone.token), allowed));

  assert.ok(broker.env);
  broker.env.removed = true;
  await vi.waitFor(async () => {
    const current = await view(desktop_.host);
    assert.ok(current.kind === "unlinked");
    assert.deepEqual(current.notice, { kind: "revoked" });
  });
  await relayGone(setup);
  const file = JSON.parse(await stored(setup));
  assert.equal(file.link, null);
  assert.deepEqual(file.unlinks, []);
});

test("a relay that says revoked is checked with a lease, and only the broker's answer forgets the link", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup, { timing: { heartbeatMs: 60_000 } });
  await serve(desktop_);
  const { broker } = setup;
  assert.ok(broker.env);
  const lease = `POST ${BROKER_ROUTES.lease(broker.env.id)}`;
  const leases = broker.count(lease);
  const auths = setup.relay.auths;

  setup.relay.close(RELAY_CLOSE.revoked);
  await vi.waitFor(() =>
    assert.equal(
      broker.count(lease),
      leases + 1,
      "not removed at the broker: one lease right away",
    ),
  );
  await vi.waitFor(() => assert.equal(setup.relay.auths, auths + 1, "and the relay comes back"));
  const current = await linked(desktop_.host);
  assert.equal(current.lease.kind, "current");
  await vi.waitFor(async () =>
    assert.deepEqual((await linked(desktop_.host)).connection, { kind: "connected" }),
  );

  broker.env.removed = true;
  setup.relay.close(RELAY_CLOSE.revoked);
  await vi.waitFor(async () => {
    const after = await view(desktop_.host);
    assert.ok(after.kind === "unlinked");
    assert.deepEqual(after.notice, { kind: "revoked" });
  });
  await relayGone(setup);
  assert.equal(JSON.parse(await stored(setup)).link, null);
});

test("another instance taking the relay over stops this one, wake included, until it is turned on again", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const phone = await setup.broker.phone();
  const { ended } = await watch(setup, desktop_.host, phone.token);

  setup.relay.close(RELAY_CLOSE.replaced);
  assert.equal(await ended, "ended");
  await vi.waitFor(async () =>
    assert.deepEqual((await linked(desktop_.host)).connection, {
      kind: "failed",
      reason: "replaced",
    }),
  );
  const auths = setup.relay.auths;
  desktop_.runtime.resume();
  await sleep(300);
  assert.equal(setup.relay.auths, auths);
  assert.deepEqual(await info(setup, phone.token), { status: 503, code: "unavailable" });

  await desktop_.host.call(1, "host.connect.setEnabled", { enabled: false });
  await desktop_.host.call(1, "host.connect.setEnabled", { enabled: true });
  await vi.waitFor(async () => assert.deepEqual(await info(setup, phone.token), allowed));
  assert.deepEqual((await linked(desktop_.host)).connection, { kind: "connected" });
});

test("waking refuses everyone until a fresh lease and dials the relay again", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup, { timing: { heartbeatMs: 60_000 } });
  await serve(desktop_);
  const { broker } = setup;
  const phone = await broker.phone();
  const { ended } = await watch(setup, desktop_.host, phone.token);
  const auths = setup.relay.auths;
  const held = Promise.withResolvers<void>();
  broker.holdNextLease = held.promise;

  desktop_.runtime.resume();
  assert.equal(await ended, "ended");
  await vi.waitFor(() => assert.equal(setup.relay.auths, auths + 1));
  await vi.waitFor(async () =>
    assert.deepEqual((await linked(desktop_.host)).connection, { kind: "connected" }),
  );
  assert.deepEqual((await linked(desktop_.host)).lease, { kind: "pending" });
  assert.deepEqual(await info(setup, phone.token), denied);

  held.resolve();
  await vi.waitFor(async () => assert.deepEqual(await info(setup, phone.token), allowed));
});

test("a cancelled link keeps its key on disk, and a restart resumes the same environment with it", async () => {
  const setup = await fixture();
  const first = await desktop(setup);
  const { broker } = setup;
  const gate = Promise.withResolvers<void>();
  broker.linkGate = gate.promise;
  const inFlight = first.host.call(1, "host.connect.link", undefined);
  await vi.waitFor(() => assert.equal(broker.count(`POST ${BROKER_ROUTES.environments}`), 1));
  const pending = JSON.parse(await stored(setup)).linkKey;
  assert.ok(Value.Check(PrivateJwk, pending.key));
  assert.equal(await keyThumbprint(pending.key), broker.env?.thumbprint);
  await first.host.call(1, "host.connect.cancel", undefined);
  gate.resolve();
  assert.equal((await inFlight).kind, "unlinked");
  await first.host.close();
  broker.linkGate = undefined;
  const environment = broker.env?.id;
  assert.deepEqual(JSON.parse(await stored(setup)).linkKey.key, pending.key);

  const second = await desktop(setup);
  assert.equal((await second.host.call(1, "host.connect.link", undefined)).kind, "linked");
  assert.equal(broker.env?.id, environment);
  const file = JSON.parse(await stored(setup));
  assert.deepEqual(file.link.key, pending.key);
  assert.equal(file.linkKey, null);
});

test("a malformed machine key on disk keeps a restart off the broker and the relay", async () => {
  const setup = await fixture();
  const first = await desktop(setup);
  await serve(first);
  await first.host.close();
  await relayGone(setup);
  const path = join(setup.state, "connect.json");
  const file = JSON.parse(await stored(setup));
  delete file.link.key.d;
  const corrupted = `${JSON.stringify(file, null, 2)}\n`;
  await writeFile(path, corrupted);
  const calls = setup.broker.calls.length;
  const auths = setup.relay.auths;

  const { host } = await desktop(setup);
  host.autostartConnect();
  await sleep(300);
  assert.deepEqual(await view(host), { kind: "unavailable", reason: "store_failed" });
  await assert.rejects(host.call(1, "host.connect.setEnabled", { enabled: true }));
  await assert.rejects(host.call(1, "host.connect.link", undefined));
  assert.equal(setup.broker.calls.length, calls);
  assert.equal(setup.relay.auths, auths);
  assert.equal(setup.relay.connected(), undefined);
  assert.equal(await stored(setup), corrupted);
});

test("nothing is linked without configuration", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup, { config: undefined });

  await assert.rejects(host.call(1, "host.connect.link", undefined));
  assert.deepEqual(await view(host), { kind: "unavailable", reason: "not_configured" });
  assert.equal(setup.account.requests, 0);
  assert.equal(setup.broker.calls.length, 0);
});

test("the build configuration must be canonical HTTPS with a bare Clerk host", () => {
  const env = {
    MAIN_VITE_NYTE_CONNECT_ORIGIN: ORIGIN,
    MAIN_VITE_NYTE_CLERK_PUBLISHABLE_KEY: CONFIG.clerk.publishableKey,
    MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST: CONFIG.clerk.frontendApiHost,
  };

  assert.deepEqual(readConnectConfig(env), CONFIG);
  assert.deepEqual(
    readConnectConfig({
      ...env,
      MAIN_VITE_NYTE_CONNECT_ORIGIN: "https://nyte-connect.example.workers.dev",
    }),
    { ...CONFIG, origin: "https://nyte-connect.example.workers.dev" },
  );

  for (const [name, value] of [
    ["MAIN_VITE_NYTE_CONNECT_ORIGIN", "http://connect.nyte.test"],
    ["MAIN_VITE_NYTE_CONNECT_ORIGIN", "https://connect.nyte.test/"],
    ["MAIN_VITE_NYTE_CONNECT_ORIGIN", "https://connect.nyte.test/r"],
    ["MAIN_VITE_NYTE_CONNECT_ORIGIN", "https://user@connect.nyte.test"],
    ["MAIN_VITE_NYTE_CONNECT_ORIGIN", ""],
    ["MAIN_VITE_NYTE_CLERK_PUBLISHABLE_KEY", "sk_test_secret"],
    ["MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST", "https://clerk.nyte.test"],
    ["MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST", "clerk.nyte.test:8443"],
    ["MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST", "clerk.nyte.test/path"],
    ["MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST", ""],
  ] as const) {
    assert.equal(readConnectConfig({ ...env, [name]: value }), undefined, `${name}=${value}`);
  }
});
