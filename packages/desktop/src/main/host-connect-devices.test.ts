/**
 * The desktop routes a device meets: enrolling, the loopback listener, a phone
 * releasing itself, a local revoke, and a store that cannot be written. See
 * `fixtures/connect-machine.ts`.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { BROKER_ROUTES, DESKTOP_ROUTES } from "@nyte-ai/connect";
import type { RelayMethod } from "@nyte-ai/connect/relay";
import { generateMachineKey, nowSeconds } from "@nyte-ai/connect/signing";
import { connectRouteHandler } from "@nyte-ai/connect/host";
import {
  cleanUp,
  fixture,
  desktop,
  view,
  linked,
  serve,
  phoneFetch,
  info,
  watch,
  forget,
  relayGone,
  stored,
  denied,
  allowed,
} from "./fixtures/connect-machine.ts";

afterEach(cleanUp);

test("the enroll route takes only a fresh, signed grant for this environment", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const token = randomBytes(32).toString("base64url");
  const grant = await broker.grant({ token });

  const status = async (input: {
    readonly authorization?: string;
    readonly method?: RelayMethod;
    readonly contentType?: string;
    readonly body?: string;
  }) =>
    (
      await broker.enrollRoute({
        method: input.method,
        contentType: input.contentType,
        body:
          input.body ??
          (input.method === undefined
            ? JSON.stringify({ authorization: input.authorization ?? grant.authorization })
            : undefined),
      })
    ).status;

  assert.equal(await status({ method: "GET" }), 405);
  assert.equal(await status({ contentType: "text/plain" }), 415);
  assert.equal(await status({ body: "x".repeat(20_000) }), 413);
  assert.equal(await status({ body: JSON.stringify({ authorization: "a.b.c", extra: 1 }) }), 400);
  assert.equal(
    (await phoneFetch(setup, DESKTOP_ROUTES.enroll, { method: "POST", body: "{}" })).status,
    404,
    "phones never reach the enroll route; only the broker relays it",
  );

  const forged = await broker.grant({
    token,
    key: { ...(await generateMachineKey()), kid: "broker-1" },
  });

  assert.equal(await status({ authorization: forged.authorization }), 401);
  const elsewhere = await broker.grant({ token, change: { aud: randomUUID() } });
  assert.equal(await status({ authorization: elsewhere.authorization }), 401);

  const stale = await broker.grant({
    token,
    change: { iat: nowSeconds() - 120, exp: nowSeconds() - 60 },
  });

  assert.equal(await status({ authorization: stale.authorization }), 401);
  const foreign = await broker.grant({ token, change: { sub: "user_other" } });
  assert.equal(await status({ authorization: foreign.authorization }), 403);
  const unsigned = `${grant.authorization.split(".").slice(0, 2).join(".")}.${"A".repeat(86)}`;
  assert.equal(await status({ authorization: unsigned }), 401);
  assert.equal((await linked(desktop_.host)).devices.length, 0);

  assert.equal((await broker.enroll(grant.authorization, grant.deviceId)).status, 200);
  assert.equal(
    (await broker.enroll(grant.authorization, grant.deviceId)).status,
    200,
    "the broker's retry gets a receipt again",
  );
  assert.equal((await linked(desktop_.host)).devices.length, 1, "and records nothing new");
  assert.deepEqual(await info(setup, token), allowed);
  const sameDigest = await broker.grant({ token });
  assert.equal(await status({ authorization: sameDigest.authorization }), 409);

  await desktop_.host.call(1, "host.connect.revokeDevice", { deviceId: grant.deviceId });
  assert.equal(await status({ authorization: grant.authorization }), 409);
  assert.deepEqual(await info(setup, token), denied, "a replay after a revoke restores nothing");
  assert.equal((await linked(desktop_.host)).devices.length, 0);
  assert.equal(JSON.parse(await stored(setup)).link.devices.length, 0);
  assert.deepEqual(setup.relay.violations, []);
});

test("on the loopback listener the desktop routes refuse browsers, other hosts, and forwarded requests", async () => {
  let bound: string | undefined;
  const reached: string[] = [];

  const handle = connectRouteHandler({
    host: () => bound,
    enroll: async () => {
      reached.push("enroll");

      return { kind: "empty" };
    },
    forget: async () => {
      reached.push("forget");

      return { kind: "empty" };
    },
  });

  const status = async (headers: Record<string, string>, url = "http://127.0.0.1:4100") => {
    const response = await handle(
      new Request(`${url}${DESKTOP_ROUTES.device}`, {
        method: "DELETE",
        headers: { authorization: "Bearer device", ...headers },
      }),
    );

    return response?.status;
  };

  const host = { host: "127.0.0.1:4100" };

  assert.equal(await status(host), 403, "before the listener is bound");
  bound = "127.0.0.1:4100";
  assert.equal(await status({ ...host, origin: "http://127.0.0.1:4100" }), 403);
  assert.equal(await status({ host: "attacker.example" }), 403);
  assert.equal(await status({ host: "127.0.0.1:4101" }), 403);
  assert.equal(await status({ host: "localhost:4100" }), 403);
  assert.equal(await status(host, "http://attacker.example"), 403);
  assert.equal(await status({ ...host, forwarded: "host=attacker.example" }), 403);
  assert.equal(await status({ ...host, "x-forwarded-host": "127.0.0.1:4100" }), 403);
  assert.deepEqual(reached, []);
  assert.equal(await status(host), 204);
  assert.deepEqual(reached, ["forget"]);
});

test("a phone releases only itself, even before a lease lists it, without being signed out", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const env = broker.env;
  assert.ok(env);
  const kept = await broker.phone();
  const token = randomBytes(32).toString("base64url");
  const pending = await broker.grant({ token });
  assert.equal(
    (await broker.enroll(pending.authorization, pending.deviceId, { activate: false })).status,
    200,
  );

  assert.equal(await forget(setup, undefined), 401);
  assert.equal(await forget(setup, randomBytes(32).toString("base64url")), 403);
  assert.equal(await forget(setup, token), 204);
  assert.equal(await forget(setup, token), 403);

  const after = await linked(desktop_.host);
  assert.deepEqual(
    after.devices.map((device) => device.id),
    [kept.deviceId],
  );
  assert.deepEqual(await info(setup, kept.token), allowed);
  await vi.waitFor(() =>
    assert.ok(broker.calls.includes(`POST ${BROKER_ROUTES.release(env.id, pending.deviceId)}`)),
  );
  assert.equal(
    broker.count(`DELETE ${BROKER_ROUTES.device(env.id, pending.deviceId)}`),
    0,
    "a release, never the revocation that would sign the phone's account out",
  );
  await vi.waitFor(async () =>
    assert.deepEqual(JSON.parse(await stored(setup)).link.revocations, []),
  );

  const { ended: streaming } = await watch(setup, desktop_.host, kept.token);
  assert.equal(await forget(setup, kept.token), 204);
  assert.equal(
    await streaming,
    "ended",
    "an active phone releasing itself loses its streams too, once its answer is out",
  );
  assert.deepEqual(await info(setup, kept.token), denied);
  await vi.waitFor(() => assert.equal(broker.active.has(kept.deviceId), false));
});

test("a local revoke refuses at once, stays queued while the broker is offline, and outranks a release", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const env = broker.env;
  assert.ok(env);
  const phone = await broker.phone();
  const released = await broker.phone();
  const { ended: streaming } = await watch(setup, desktop_.host, phone.token);

  const queued = async () =>
    JSON.parse(await stored(setup)).link.revocations.map(
      (entry: { deviceId: string; kind: string }) => [entry.deviceId, entry.kind],
    );

  broker.offline = true;
  await desktop_.host.call(1, "host.connect.revokeDevice", { deviceId: phone.deviceId });
  assert.equal(await streaming, "ended");
  assert.deepEqual(await info(setup, phone.token), denied);
  assert.equal(await forget(setup, released.token), 204);
  assert.deepEqual(await queued(), [
    [phone.deviceId, "revoke"],
    [released.deviceId, "release"],
  ]);
  await desktop_.host.call(1, "host.connect.revokeDevice", { deviceId: released.deviceId });
  assert.deepEqual(
    await queued(),
    [
      [phone.deviceId, "revoke"],
      [released.deviceId, "revoke"],
    ],
    "the user removing a device that released itself still signs its session out",
  );

  broker.offline = false;
  assert.deepEqual(
    await info(setup, phone.token),
    denied,
    "still listed by the broker's leases, still refused here",
  );
  await desktop_.host.call(1, "host.connect.revokeDevice", { deviceId: phone.deviceId });
  await vi.waitFor(async () => assert.deepEqual(await queued(), []));
  assert.equal(broker.active.has(phone.deviceId), false);
  assert.equal(broker.active.has(released.deviceId), false);
  assert.equal(broker.count(`POST ${BROKER_ROUTES.release(env.id, released.deviceId)}`), 0);
  assert.equal(broker.count(`DELETE ${BROKER_ROUTES.device(env.id, released.deviceId)}`), 1);
});

test("a store that cannot be written refuses everyone and stops serving", async () => {
  const setup = await fixture();
  const desktop_ = await desktop(setup);
  await serve(desktop_);
  const { broker } = setup;
  const phone = await broker.phone();
  const { ended: streaming } = await watch(setup, desktop_.host, phone.token);

  await chmod(setup.state, 0o500);
  await chmod(join(setup.state, "connect.json"), 0o400);
  const token = randomBytes(32).toString("base64url");
  const grant = await broker.grant({ token });
  const answer = await broker.enroll(grant.authorization, grant.deviceId);
  assert.equal(answer.status, 500);
  assert.equal(answer.body.includes("receipt"), false);
  assert.equal(await streaming, "ended");
  await relayGone(setup);
  assert.deepEqual(await view(desktop_.host), { kind: "unavailable", reason: "store_failed" });
  await assert.rejects(desktop_.host.call(1, "host.connect.setEnabled", { enabled: true }));
});
