/**
 * Leases decide who a linked Mac serves: which devices get in, when a lease is
 * asked for, and which leases are refused. See `fixtures/connect-machine.ts`.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { BROKER_ROUTES, TOKEN_TYPES } from "@nyte-ai/connect";
import {
  PrivateJwk,
  generateMachineKey,
  keyThumbprint,
  randomId,
  sha256,
  signClaims,
} from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import {
  cleanUp,
  OWNER,
  SESSION_JWT,
  fixture,
  desktop,
  view,
  linked,
  serve,
  address,
  info,
  watch,
  relayGone,
  stored,
  denied,
  allowed,
} from "./fixtures/connect-machine.ts";
import type { Fixture, LeaseCraft } from "./fixtures/connect-machine.ts";

afterEach(cleanUp);

/** Back-date a recorded device, as if an earlier run had recorded it `ageMs` ago. */
async function backdateDevice(setup: Fixture, deviceId: string, ageMs: number): Promise<void> {
  const path = join(setup.state, "connect.json");
  const file = JSON.parse(await readFile(path, "utf8"));

  for (const device of file.link.devices)
    if (device.id === deviceId) device.createdAt = Date.now() - ageMs;
  await writeFile(path, JSON.stringify(file));
}

test("a linked Mac serves only leased devices, and no session secret reaches disk or the renderer", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  const serving = await serve(desktop_);
  const { broker } = setup;

  assert.equal(serving.owner.id, OWNER.id);
  assert.equal(serving.enabled, true);
  assert.equal(serving.environment.address, address(setup));
  assert.deepEqual(
    broker.bearers,
    [`${BROKER_ROUTES.environments} Bearer ${SESSION_JWT}`],
    "only the link carried the session JWT; the heartbeat and the relay sign with the machine key",
  );
  assert.equal(setup.relay.connected(), serving.environment.id);

  assert.deepEqual(await info(setup, undefined), { status: 401, code: "unauthenticated" });
  assert.deepEqual(await info(setup, randomBytes(32).toString("base64url")), denied);
  const phone = await broker.phone();
  assert.deepEqual(await info(setup, phone.token), allowed);

  const file = await stored(setup);
  assert.equal((await stat(join(setup.state, "connect.json"))).mode & 0o777, 0o600);
  const parsed = JSON.parse(file);
  assert.equal(file.includes(SESSION_JWT), false);
  assert.equal(file.includes(phone.token), false);
  assert.deepEqual(parsed.link.environment, { id: serving.environment.id, name: "Fixture Mac" });
  assert.ok(Value.Check(PrivateJwk, parsed.link.key));
  assert.equal(await keyThumbprint(parsed.link.key), broker.env?.thumbprint);
  assert.equal(parsed.link.devices[0].digest, await sha256(phone.token));

  const after = await linked(desktop_.host);
  assert.deepEqual(
    after.devices.map((device) => [device.id, device.authorized]),
    [[phone.deviceId, true]],
  );
  const renderer = JSON.stringify([after, desktop_.events]);

  for (const hidden of [SESSION_JWT, phone.token, parsed.link.key.d])
    assert.equal(renderer.includes(hidden), false);
  assert.ok(desktop_.events.some((event) => event.kind === "remote_access_changed"));
  assert.deepEqual(setup.relay.violations, []);
});

test("a phone's first request after enrolling waits for one fresh lease instead of being refused", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup, { timing: { heartbeatMs: 60_000 } });
  await serve(desktop_);
  const leases = setup.broker.count(`POST ${BROKER_ROUTES.lease(setup.broker.env?.id ?? "")}`);

  const phone = await setup.broker.phone();
  assert.deepEqual(await info(setup, phone.token), allowed);
  const lease = `POST ${BROKER_ROUTES.lease(setup.broker.env?.id ?? "")}`;
  assert.equal(
    setup.broker.count(lease),
    leases + 1,
    "the heartbeat is slow, so only the readiness refresh brought the new device in",
  );

  const token = randomBytes(32).toString("base64url");
  const grant = await setup.broker.grant({ token });
  assert.equal(
    (await setup.broker.enroll(grant.authorization, grant.deviceId, { activate: false })).status,
    200,
  );
  const answers = await Promise.all([info(setup, token), info(setup, token), info(setup, token)]);
  assert.deepEqual(answers, [denied, denied, denied], "recorded but never activated: refused");
  assert.equal(setup.broker.count(lease), leases + 2, "after one shared refresh");
  assert.deepEqual(await info(setup, token), denied);
  assert.equal(setup.broker.count(lease), leases + 2, "and no refresh again for 30 s");
});

test("a device the broker activates after a lease was snapshotted gets in on a lease asked for after its request", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup, { timing: { heartbeatMs: 300 } });
  await serve(desktop_);
  const { broker } = setup;
  const lease = `POST ${BROKER_ROUTES.lease(broker.env?.id ?? "")}`;
  const token = randomBytes(32).toString("base64url");
  const grant = await broker.grant({ token });

  assert.equal(
    (await broker.enroll(grant.authorization, grant.deviceId, { activate: false })).status,
    200,
  );
  const recorded = broker.count(lease);
  await vi.waitFor(() =>
    assert.ok(
      broker.count(lease) >= recorded + 2,
      "recorded here, not yet active at the broker: leases asked for after that still omit it",
    ),
  );
  const held = Promise.withResolvers<void>();
  broker.holdNextLease = held.promise;
  const before = broker.count(lease);
  await vi.waitFor(() =>
    assert.equal(
      broker.count(lease),
      before + 1,
      "the next answer is snapshotted without the device and held in flight",
    ),
  );

  broker.active.add(grant.deviceId);
  broker.policy += 1;
  const began = Date.now();
  assert.deepEqual(
    await info(setup, token),
    allowed,
    "the broker activated it and answered the phone, whose first request arrived then",
  );
  assert.ok(Date.now() - began < 2_000, "the request waited on the stale lease");

  held.resolve();
  await vi.waitFor(() => assert.ok(broker.count(lease) >= before + 3));
  assert.deepEqual(
    await info(setup, token),
    allowed,
    "the older answer lands last and changes nothing",
  );
});

test("showing the sign-in dialog while a link waits on it does not replace that request", async () => {
  const setup = await fixture();
  const { host } = await desktop(setup);
  setup.account.hold = true;
  const waiting = host.call(1, "host.connect.link", undefined);
  await vi.waitFor(() => assert.equal(setup.account.requests, 1));

  await host.call(1, "host.connect.openAccount", undefined);
  assert.equal(setup.account.focused, 1);
  assert.equal(setup.account.requests, 1);
  const current = await view(host);
  assert.ok(current.kind === "unlinked" && current.linking.kind === "waiting_for_account");

  await host.call(1, "host.connect.cancel", undefined);
  assert.equal((await waiting).kind, "unlinked");
});

test("a readiness refresh that fails may be tried again within the phone's retry window", async () => {
  const setup = await fixture();

  const desktop_ = await desktop(setup, {
    timing: { heartbeatMs: 60_000, retryMs: 60_000, readinessRetryMs: 100 },
  });

  await serve(desktop_);
  const { broker } = setup;

  broker.leaseMode = "offline";
  const phone = await broker.phone();
  assert.deepEqual(await info(setup, phone.token), denied);
  broker.leaseMode = "ok";
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(await info(setup, phone.token), allowed);
});

test("devices the broker no longer has active are forgotten once their grant could not still land", async () => {
  const setup = await fixture();
  const first = await desktop(setup);
  await serve(first);
  const { broker } = setup;
  const stale = randomBytes(32).toString("base64url");
  const staleGrant = await broker.grant({ token: stale });
  assert.equal(
    (await broker.enroll(staleGrant.authorization, staleGrant.deviceId, { activate: false }))
      .status,
    200,
  );
  const kept = await broker.phone();
  await first.host.close();

  await backdateDevice(setup, staleGrant.deviceId, 120_000);
  const fresh = randomBytes(32).toString("base64url");

  const second = await desktop(setup);
  second.host.autostartConnect();
  await vi.waitFor(async () => assert.deepEqual(await info(setup, kept.token), allowed));
  const freshGrant = await broker.grant({ token: fresh });
  assert.equal(
    (await broker.enroll(freshGrant.authorization, freshGrant.deviceId, { activate: false }))
      .status,
    200,
  );

  await vi.waitFor(async () =>
    assert.deepEqual(
      JSON.parse(await stored(setup)).link.devices.map((device: { id: string }) => device.id),
      [kept.deviceId, freshGrant.deviceId],
    ),
  );
  assert.deepEqual(await info(setup, stale), denied);
});

test("after a restart a recorded device is refused until a lease verifies", async () => {
  const setup = await fixture();
  const first = await desktop(setup);
  await serve(first);
  const phone = await setup.broker.phone();
  assert.deepEqual(await info(setup, phone.token), allowed);
  await first.host.close();
  await relayGone(setup);

  setup.broker.leaseMode = "offline";
  const second = await desktop(setup);
  second.host.autostartConnect();
  await vi.waitFor(async () =>
    assert.equal((await linked(second.host)).connection.kind, "connected"),
  );
  assert.equal(
    (await linked(second.host)).lease.kind,
    "pending",
    "the relay is up on the machine key alone",
  );
  assert.deepEqual(await info(setup, phone.token), denied, "and nobody gets in");

  setup.broker.leaseMode = "ok";
  await vi.waitFor(async () => assert.deepEqual(await info(setup, phone.token), allowed));
});

test("a lease that drops a device ends its streams; one that lapses ends everyone's", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const revoked = await broker.phone();
  const kept = await broker.phone();
  const { ended: revokedWatch } = await watch(setup, desktop_.host, revoked.token);
  const { ended: keptWatch } = await watch(setup, desktop_.host, kept.token);
  const auths = setup.relay.auths;

  broker.active.delete(revoked.deviceId);
  broker.policy += 1;
  assert.equal(
    await revokedWatch,
    "ended",
    "revoked from the phone's account at the broker, heard in the next lease",
  );
  assert.equal(await keptWatch, "ended");
  assert.deepEqual(await info(setup, revoked.token), denied);
  assert.deepEqual(await info(setup, kept.token), allowed);

  broker.leaseAge = 58;
  broker.policy += 1;
  await vi.waitFor(async () => {
    const current = await linked(desktop_.host);
    assert.ok(
      current.lease.kind === "current" && current.lease.expiresAt < Date.now() + 2_500,
      "a newer policy orders leases signed 58 s ago after the fresh ones, as any device change at the broker would",
    );
  });
  const { ended: lapsing } = await watch(setup, desktop_.host, kept.token);
  broker.leaseMode = "offline";
  const began = Date.now();
  assert.equal(await lapsing, "ended", "an old lease lapses once the broker stops answering");
  assert.ok(Date.now() - began < 3_000, "the stream outlived its lease");
  assert.deepEqual((await linked(desktop_.host)).lease, { kind: "lapsed", reason: "offline" });
  assert.deepEqual(await info(setup, kept.token), denied);

  assert.equal(setup.relay.auths, auths, "the same relay socket throughout");
  assert.equal(setup.relay.connected(), broker.env?.id);
  assert.deepEqual(setup.relay.violations, []);
});

test("replayed, older, or misaddressed leases never bring a dropped device back", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const phone = await broker.phone();
  assert.deepEqual(await info(setup, phone.token), allowed);
  const listing = broker.leases.at(-1);
  assert.ok(listing);
  const policyWithPhone = broker.policy;
  broker.active.delete(phone.deviceId);
  broker.policy += 1;
  await vi.waitFor(async () => assert.deepEqual(await info(setup, phone.token), denied));
  const other = await generateMachineKey();
  const forged = { ...other, kid: "broker-1" };
  const lease = `POST ${BROKER_ROUTES.lease(broker.env?.id ?? "")}`;

  const crafts: readonly [string, LeaseCraft][] = [
    ["a replayed lease", async () => listing],
    [
      "a lower policy",
      ({ claims }) =>
        signClaims({
          key: broker.signing,
          typ: TOKEN_TYPES.lease,
          claims: { ...claims, policy: policyWithPhone, devices: [phone.deviceId] },
        }),
    ],
    [
      "an older generation",
      ({ claims }) =>
        signClaims({
          key: broker.signing,
          typ: TOKEN_TYPES.lease,
          claims: { ...claims, generation: 0, devices: [phone.deviceId] },
        }),
    ],
    [
      "another environment",
      ({ claims }) =>
        signClaims({
          key: broker.signing,
          typ: TOKEN_TYPES.lease,
          claims: { ...claims, aud: randomUUID(), policy: 999, devices: [phone.deviceId] },
        }),
    ],
    [
      "another owner",
      ({ claims }) =>
        signClaims({
          key: broker.signing,
          typ: TOKEN_TYPES.lease,
          claims: { ...claims, sub: "user_other", policy: 999, devices: [phone.deviceId] },
        }),
    ],
    [
      "a key that is not the broker's",
      ({ claims }) =>
        signClaims({
          key: forged,
          typ: TOKEN_TYPES.lease,
          claims: { ...claims, policy: 999, devices: [phone.deviceId] },
        }),
    ],
    [
      "an enrollment presented as a lease",
      ({ claims }) =>
        signClaims({
          key: broker.signing,
          typ: TOKEN_TYPES.enrollment,
          claims: { ...claims, policy: 999, devices: [phone.deviceId] },
        }),
    ],
    [
      "another request's lease",
      ({ claims }) =>
        signClaims({
          key: broker.signing,
          typ: TOKEN_TYPES.lease,
          claims: { ...claims, req: randomId(), policy: 999, devices: [phone.deviceId] },
        }),
    ],
  ];

  for (const [name, craft] of crafts) {
    broker.craft = craft;
    const before = broker.count(lease);
    await vi.waitFor(() => assert.ok(broker.count(lease) >= before + 2, name));
    assert.deepEqual(await info(setup, phone.token), denied, name);
  }
});
