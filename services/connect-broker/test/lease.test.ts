import { ErrorBody, LEASE_LIFETIME_SECONDS } from "@nyte-ai/connect";
import { Value } from "typebox/value";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, createHarness, read } from "./harness.ts";
import type { FakeDesktop, Harness } from "./harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.dispose();
});

beforeEach(async () => {
  await harness.reset();
});

const code = (body: unknown) => (Value.Check(ErrorBody, body) ? body.error.code : undefined);

async function linked(userId = "user_alice"): Promise<FakeDesktop> {
  const { desktop } = await harness.link({ userId });

  return desktop;
}

describe("leases", () => {
  it("signs a short allowlist bound to the request proof", async () => {
    const desktop = await linked();
    const { answer, claims, jti } = await harness.lease(desktop);

    expect(answer.status).toBe(200);
    expect(claims).toEqual(
      expect.objectContaining({
        iss: ORIGIN,
        aud: desktop.environmentId,
        sub: "user_alice",
        req: jti,
        generation: 1,
        devices: [],
      }),
    );
    expect((claims?.exp ?? 0) - (claims?.iat ?? 0)).toBe(LEASE_LIFETIME_SECONDS);
  });

  it("lists a desktop online only with an attached relay socket and a recent lease", async () => {
    const desktop = await linked();
    const online = async () => {
      const listed = await harness.send({
        method: "GET",
        path: "/v1/environments",
        headers: {
          authorization: `Bearer ${await harness.sessionToken({ userId: "user_alice" })}`,
        },
      });

      return read(listed.body, "environments", "0", "online");
    };

    expect(await online()).toBe(false);
    harness.relay.connected.add(desktop.environmentId);
    expect(await online()).toBe(false);
    await harness.lease(desktop);
    expect(await online()).toBe(true);
    harness.clock.offsetMs = 91_000;
    expect(await online()).toBe(false);
    harness.clock.offsetMs = 0;
    expect(await online()).toBe(true);
    harness.relay.connected.delete(desktop.environmentId);
    expect(await online()).toBe(false);
  });

  it("refuses a replayed proof, another key, another path, and a non-empty body", async () => {
    const desktop = await linked();
    const other = await linked("user_bob");
    const path = `/v1/environments/${desktop.environmentId}/lease`;
    const proof = await harness.proof({
      key: desktop.key,
      issuer: desktop.environmentId,
      method: "POST",
      path,
      body: "{}",
    });
    const lease = (token: string, body = "{}", to = path) =>
      harness.send({ method: "POST", path: to, headers: { "nyte-proof": token }, body });

    expect((await lease(proof)).status).toBe(200);
    expect((await lease(proof)).status).toBe(401);
    const foreign = await harness.proof({
      key: other.key,
      issuer: desktop.environmentId,
      method: "POST",
      path,
      body: "{}",
    });

    expect((await lease(foreign)).status).toBe(401);
    const crossPath = await harness.proof({
      key: desktop.key,
      issuer: desktop.environmentId,
      method: "POST",
      path,
      body: "{}",
    });

    expect(
      (await lease(crossPath, "{}", `/v1/environments/${other.environmentId}/lease`)).status,
    ).toBe(401);
    const extra = JSON.stringify({ devices: ["x"] });
    const extraProof = await harness.proof({
      key: desktop.key,
      issuer: desktop.environmentId,
      method: "POST",
      path,
      body: extra,
    });

    expect((await lease(extraProof, extra)).status).toBe(400);
  });

  it("orders leases by a policy that grows with every device change", async () => {
    const desktop = await linked();
    const policies = [(await harness.lease(desktop)).claims?.policy ?? 0];
    const enrolled = await harness.enroll({
      userId: "user_alice",
      environmentId: desktop.environmentId,
    });

    policies.push((await harness.lease(desktop)).claims?.policy ?? 0);
    await harness.removeDevice(
      { as: "desktop", desktop },
      { environmentId: desktop.environmentId, deviceId: String(read(enrolled.body, "deviceId")) },
    );
    const last = await harness.lease(desktop);

    policies.push(last.claims?.policy ?? 0);
    expect(policies[1]).toBeGreaterThan(policies[0] ?? Infinity);
    expect(policies[2]).toBeGreaterThan(policies[1] ?? Infinity);
    expect(last.claims?.devices).toEqual([]);
  });

  it("refuses a revoked environment", async () => {
    const desktop = await linked();

    await harness.removeEnvironment({ as: "owner", userId: "user_alice" }, desktop.environmentId);
    const { answer } = await harness.lease(desktop);

    expect(answer.status).toBe(410);
    expect(code(answer.body)).toBe("revoked");
  });

  it("never asks Clerk on a lease", async () => {
    const desktop = await linked();
    const calls = harness.clerkApi.calls.length;

    harness.clerkApi.userStatus = 503;
    harness.clock.offsetMs = 2 * 60 * 60_000;
    expect((await harness.lease(desktop)).answer.status).toBe(200);
    expect(harness.clerkApi.calls).toHaveLength(calls);
  });

  it("rate-limits leases per environment", async () => {
    const desktop = await linked();
    const statuses: number[] = [];

    for (let index = 0; index < 21; index += 1)
      statuses.push((await harness.lease(desktop)).answer.status);

    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});
