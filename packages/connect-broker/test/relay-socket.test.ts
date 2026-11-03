/** The desktop's relay socket: proving itself, being replaced, hibernating, and being revoked. See `relay-fixture.ts`. */
import { BROKER_ROUTES, EnvironmentList } from "@nyte-ai/connect";
import { RELAY_AUTH_TIMEOUT_MS, RELAY_CLOSE, RELAY_PING } from "@nyte-ai/connect/relay";
import { createProof, generateMachineKey, randomId } from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import { RelayDesktop } from "./workerd.ts";
import { describe, expect, it } from "vitest";
import {
  echo,
  linked,
  attached,
  socket,
  relayProof,
  enrolled,
  phone,
  wireError,
  refused,
  leftOpen,
  waitFor,
  broker,
  withWorkerdRelay,
} from "./relay-fixture.ts";

withWorkerdRelay();

describe("the desktop's relay socket", () => {
  it("attaches with a proof for its relay path and lists online with a recent lease", async () => {
    const { environmentId, key } = await linked();
    const list = async () => {
      const response = await broker.fetch(`${broker.origin}${BROKER_ROUTES.environments}`, {
        headers: {
          authorization: `Bearer ${await broker.sessionToken({ userId: "user_alice" })}`,
        },
      });
      const body: unknown = await response.json();

      return Value.Check(EnvironmentList, body) ? body.environments[0]?.online : undefined;
    };
    const desktop = await attached({ environmentId, key });

    expect(await list()).toBe(false);
    const leaseBody = "{}";
    const lease = await broker.fetch(`${broker.origin}${BROKER_ROUTES.lease(environmentId)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "nyte-proof": await createProof({
          key,
          issuer: environmentId,
          audience: broker.origin,
          method: "POST",
          path: BROKER_ROUTES.lease(environmentId),
          body: leaseBody,
        }),
      },
      body: leaseBody,
    });

    expect(lease.status).toBe(200);
    expect(await list()).toBe(true);
    desktop.close();
    await waitFor(async () => (await list()) === false);
  });

  it("closes a socket whose first frame is not a fresh proof of the environment's key", async () => {
    const { environmentId, key } = await linked();
    const proof = await relayProof({ environmentId, key });
    const first = await socket(environmentId);

    first.send({ t: "auth", proof });
    await first.next("ready");
    const cases: [string, (desktop: RelayDesktop) => Promise<void>, number][] = [
      ["a replayed proof", async (desktop) => desktop.send({ t: "auth", proof }), 4401],
      [
        "another key",
        async (desktop) =>
          desktop.send({
            t: "auth",
            proof: await relayProof({ environmentId, key: await generateMachineKey() }),
          }),
        4401,
      ],
      [
        "another path",
        async (desktop) =>
          desktop.send({
            t: "auth",
            proof: await relayProof({
              environmentId,
              key,
              path: BROKER_ROUTES.lease(environmentId),
            }),
          }),
        4401,
      ],
      [
        "a frame other than auth",
        async (desktop) => desktop.send({ t: "end", ch: randomId() }),
        4401,
      ],
      ["a binary frame", async (desktop) => desktop.socket.send(new Uint8Array([123])), 4400],
      ["text outside the contract", async (desktop) => desktop.socket.send("{"), 4400],
    ];

    for (const [label, act, code] of cases) {
      const desktop = await socket(environmentId);

      await act(desktop);
      expect({ label, code: (await desktop.closed).code }).toEqual({ label, code });
    }

    expect(first.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("closes a socket that has not proven itself within five seconds", async () => {
    const { environmentId } = await linked();
    const started = Date.now();
    const desktop = await socket(environmentId);

    await leftOpen(desktop);
    expect(Date.now() - started).toBeGreaterThanOrEqual(RELAY_AUTH_TIMEOUT_MS - 100);
  }, 15_000);

  it("holds at most four unproven sockets, closing the oldest", async () => {
    const { environmentId, key } = await linked();
    const pending = [];

    for (let index = 0; index < 5; index += 1) pending.push(await socket(environmentId));

    if (pending[0] !== undefined) await leftOpen(pending[0]);
    expect(pending.slice(1).map((desktop) => desktop.socket.readyState)).toEqual([1, 1, 1, 1]);
    pending[4]?.send({ t: "auth", proof: await relayProof({ environmentId, key }) });
    await pending[4]?.next("ready");
  });

  it("lets a newer proof replace the authenticated socket, ending its channels", async () => {
    const { environmentId, key, desktop, bearer } = await enrolled();

    desktop.handler = undefined;
    const waiting = phone({ environmentId, bearer }, "/sessions.list");
    await desktop.next("open");
    const replacement = await attached({ environmentId, key });

    expect((await desktop.closed).code).toBe(RELAY_CLOSE.replaced);
    expect(await wireError(await waiting)).toEqual(refused(503, "closed"));
    replacement.handler = echo;
    const answer = await phone({ environmentId, bearer }, "/sessions.list");

    expect(await answer.text()).toBe("POST /sessions.list");
  });

  it("keeps its socket and answers pings across hibernation", async () => {
    const { environmentId, desktop, bearer } = await enrolled();

    await broker.evictRelay(environmentId);
    desktop.socket.send(RELAY_PING);
    await desktop.next("pong");
    const answer = await phone({ environmentId, bearer }, "/.nyte/identity?nonce=n1", {
      method: "GET",
    });

    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe("GET /.nyte/identity?nonce=n1");
  });

  it("forwards the discovery routes without a bearer, and nothing else", async () => {
    const { environmentId } = await enrolled();
    const identity = await phone({ environmentId }, "/.nyte/identity?nonce=n1", { method: "GET" });
    const described = await phone({ environmentId }, "/.nyte/describe", { method: "GET" });

    expect(await identity.text()).toBe("GET /.nyte/identity?nonce=n1");
    expect(await described.text()).toBe("GET /.nyte/describe");
    expect(await wireError(await phone({ environmentId }, "/sessions.list"))).toEqual(
      refused(401, "unauthorized"),
    );
  });

  it("closes with revoked when the environment is removed, and refuses its proofs after", async () => {
    const { environmentId, key } = await linked();
    const desktop = await attached({ environmentId, key });
    const removed = await broker.fetch(
      `${broker.origin}${BROKER_ROUTES.environment(environmentId)}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${await broker.sessionToken({ userId: "user_alice" })}`,
        },
      },
    );

    expect(removed.status).toBe(204);
    expect((await desktop.closed).code).toBe(RELAY_CLOSE.revoked);
    const again = await socket(environmentId);

    again.send({ t: "auth", proof: await relayProof({ environmentId, key }) });
    expect((await again.closed).code).toBe(RELAY_CLOSE.revoked);
  });
});
