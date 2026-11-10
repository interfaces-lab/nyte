import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { socketTest } from "../fixtures/desktop-host.ts";
import { BROKER_ROUTES } from "@nyte-ai/connect";
import { PrivateJwk, keyThumbprint } from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import { readConnectConfig } from "../../shared/connect-config.ts";
import {
  cleanUp,
  ORIGIN,
  sessionJwt,
  CONFIG,
  fixture,
  desktop,
  view,
  linked,
  relayGone,
  stored,
} from "../fixtures/connect-machine.ts";

afterEach(cleanUp);

socketTest("cancel, disable, and quit win over work still in flight", async () => {
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
  await vi.waitFor(() => {
    assert.equal(broker.count(`POST ${BROKER_ROUTES.environments}`), 1);
    assert.ok(broker.env, "the broker holds the link at its gate");
  });
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

socketTest("a tombstoned key from an abandoned link is replaced, not retried forever", async () => {
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

socketTest("a link another account began is not resumed under this one", async () => {
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

socketTest(
  "pending unlinks are kept until the broker confirms them, and a full queue holds new links back",
  async () => {
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
  },
  30_000,
);

socketTest(
  "a cancelled link keeps its key on disk, and a restart resumes the same environment with it",
  async () => {
    const setup = await fixture();
    const first = await desktop(setup);
    const { broker } = setup;
    const gate = Promise.withResolvers<void>();
    broker.linkGate = gate.promise;
    const inFlight = first.host.call(1, "host.connect.link", undefined);
    await vi.waitFor(() => {
      assert.equal(broker.count(`POST ${BROKER_ROUTES.environments}`), 1);
      assert.ok(broker.env, "the broker holds the link at its gate");
    });
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
  },
);

socketTest("nothing is linked without configuration", async () => {
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
    ["MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST", "clerk.other.test"],
    ["MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST", "https://clerk.nyte.test"],
    ["MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST", "clerk.nyte.test:8443"],
    ["MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST", "clerk.nyte.test/path"],
    ["MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST", ""],
  ] as const) {
    assert.equal(readConnectConfig({ ...env, [name]: value }), undefined, `${name}=${value}`);
  }
});
