import { EnrollResponse, ErrorBody } from "@nyte-ai/connect";
import { sha256 } from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDesktop, createHarness, read } from "./harness.ts";
import type { DesktopMode, Harness } from "./harness.ts";

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
  const { desktop, answer } = await harness.link({ userId });

  expect(answer.status).toBe(201);

  return desktop;
}

async function deviceState(deviceId: string): Promise<unknown> {
  return read(
    (await harness.rows("devices")).find((row) => read(row, "id") === deviceId),
    "state",
  );
}

describe("enrolling a device", () => {
  it("answers only after the device is active, and the next lease lists it", async () => {
    const desktop = await linked();
    const before = await harness.lease(desktop);
    const digest = await sha256("phone bearer token");
    let duringForward: unknown;
    let leaseDuringForward: readonly string[] | undefined;

    desktop.beforeReceipt = async () => {
      const grant = desktop.recorded.at(-1);

      duringForward = await deviceState(grant?.deviceId ?? "");
      leaseDuringForward = (await harness.lease(desktop)).claims?.devices;
    };
    const answer = await harness.enroll({
      userId: "user_alice",
      environmentId: desktop.environmentId,
      digest,
    });

    expect(answer.status).toBe(201);
    expect(Value.Check(EnrollResponse, answer.body)).toBe(true);
    const deviceId = String(read(answer.body, "deviceId"));

    expect(answer.body).toEqual({ environmentId: desktop.environmentId, deviceId });
    expect(harness.relay.calls).toEqual([
      {
        operation: "/forward",
        environmentId: desktop.environmentId,
        deviceId: null,
        path: "/_nyte/connect/enroll",
      },
    ]);
    expect(duringForward).toBe("reserved");
    expect(leaseDuringForward).toEqual([]);
    expect(desktop.recorded).toEqual([
      expect.objectContaining({ sub: "user_alice", aud: desktop.environmentId, deviceId, digest }),
    ]);
    const after = await harness.lease(desktop);

    expect(after.claims?.devices).toEqual([deviceId]);
    expect(after.claims?.policy).toBeGreaterThan(before.claims?.policy ?? Infinity);
    expect(after.claims?.generation).toBe(before.claims?.generation);
    expect(JSON.stringify(await harness.rows("devices"))).not.toContain("phone bearer token");
  });

  it.each<[DesktopMode]>([
    ["down"],
    ["refuse"],
    ["huge"],
    ["foreign-key"],
    ["wrong-nonce"],
    ["wrong-digest"],
  ])("leaves no usable device when the desktop is %s", async (mode) => {
    const desktop = await linked();

    desktop.mode = mode;
    const answer = await harness.enroll({
      userId: "user_alice",
      environmentId: desktop.environmentId,
    });

    expect(answer.status).toBe(502);
    expect(code(answer.body)).toBe("unreachable");
    expect(read(await harness.rows("devices"), "0", "state")).toBe("revoked");
    desktop.mode = "ok";
    expect((await harness.lease(desktop)).claims?.devices).toEqual([]);
  });

  it("refuses to activate a device revoked while the desktop was recording it", async () => {
    const desktop = await linked();

    desktop.beforeReceipt = async () => {
      const grant = desktop.recorded.at(-1);
      const revoked = await harness.removeDevice(
        { as: "owner", userId: "user_alice", sessionId: "sess_other_phone" },
        { environmentId: desktop.environmentId, deviceId: grant?.deviceId ?? "" },
      );

      expect(revoked.status).toBe(204);
    };
    const answer = await harness.enroll({
      userId: "user_alice",
      environmentId: desktop.environmentId,
    });

    expect(answer.status).toBe(409);
    expect(code(answer.body)).toBe("conflict");
    const deviceId = desktop.recorded.at(-1)?.deviceId ?? "";

    expect(await deviceState(deviceId)).toBe("revoked");
    expect((await harness.lease(desktop)).claims?.devices).toEqual([]);
    desktop.beforeReceipt = undefined;
    const again = await harness.enroll({
      userId: "user_alice",
      environmentId: desktop.environmentId,
    });

    expect(code(again.body)).toBe("session_revoked");
  });

  it("refuses to activate when the environment is removed or the grant lapses during the forward", async () => {
    const removed = await linked();

    removed.beforeReceipt = async () => {
      await harness.removeEnvironment({ as: "desktop", desktop: removed }, removed.environmentId);
    };
    expect(
      (await harness.enroll({ userId: "user_alice", environmentId: removed.environmentId })).status,
    ).toBe(409);

    const lapsed = await linked();

    lapsed.beforeReceipt = async () => {
      harness.clock.offsetMs = 90_000;
    };
    const answer = await harness.enroll({
      userId: "user_alice",
      environmentId: lapsed.environmentId,
    });

    expect(answer.status).toBe(409);
    expect(read(await harness.rows("devices"), "1", "state")).toBe("revoked");
  });

  it("replaces the earlier device of the same client", async () => {
    const desktop = await linked();
    const first = await harness.enroll({
      userId: "user_alice",
      environmentId: desktop.environmentId,
    });
    const second = await harness.enroll({
      userId: "user_alice",
      environmentId: desktop.environmentId,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await harness.lease(desktop)).claims?.devices).toEqual([read(second.body, "deviceId")]);
    expect(await deviceState(String(read(first.body, "deviceId")))).toBe("revoked");
  });

  it("enforces the device limit", async () => {
    const desktop = await linked();

    expect((await harness.lease(desktop)).answer.status).toBe(200);
    const storage = harness.relay.storages.get(desktop.environmentId);

    for (let index = 0; index < 20; index += 1)
      storage?.sql.exec(
        `INSERT INTO devices (id, client_id, client_name, digest, session_id, state, grant_id,
           nonce, grant_expires_at, created_at)
         VALUES (?1, ?2, 'Phone', ?3, 'sess_x', 'active', ?4, 'nonce-nonce-nonce-nonce', 0, 0)`,
        crypto.randomUUID(),
        `client-${index}-0000000000`,
        "d".repeat(43),
        `grant-${index}-000000000000000000`,
      );
    const answer = await harness.enroll({
      userId: "user_alice",
      environmentId: desktop.environmentId,
    });

    expect(code(answer.body)).toBe("limit");
    expect(desktop.recorded).toEqual([]);
    expect((await harness.lease(desktop)).claims?.devices).toHaveLength(20);
  });

  it("ends reservations whose grant lapsed before counting the limit", async () => {
    const desktop = await linked();

    expect((await harness.lease(desktop)).answer.status).toBe(200);
    const storage = harness.relay.storages.get(desktop.environmentId);

    for (let index = 0; index < 20; index += 1)
      storage?.sql.exec(
        `INSERT INTO devices (id, client_id, client_name, digest, session_id, state, grant_id,
           nonce, grant_expires_at, created_at)
         VALUES (?1, ?2, 'Phone', ?3, 'sess_x', 'reserved', ?4, 'nonce-nonce-nonce-nonce', ?5, ?5)`,
        crypto.randomUUID(),
        `client-${index}-0000000000`,
        "d".repeat(43),
        `grant-${index}-000000000000000000`,
        Date.now() - 60_000,
      );
    const answer = await harness.enroll({
      userId: "user_alice",
      environmentId: desktop.environmentId,
    });

    expect(answer.status).toBe(201);
    const ended = (await harness.rows("devices")).filter(
      (row) => read(row, "revoke_reason") === "expired",
    );

    expect(ended).toHaveLength(20);
  });

  it("hides other owners' environments and devices", async () => {
    const alice = await linked("user_alice");
    const bob = await linked("user_bob");
    const enrolled = await harness.enroll({
      userId: "user_alice",
      environmentId: alice.environmentId,
    });
    const deviceId = String(read(enrolled.body, "deviceId"));

    expect(
      code((await harness.enroll({ userId: "user_bob", environmentId: alice.environmentId })).body),
    ).toBe("not_found");
    expect(
      (
        await harness.removeDevice(
          { as: "owner", userId: "user_bob" },
          { environmentId: alice.environmentId, deviceId },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await harness.removeDevice(
          { as: "owner", userId: "user_bob" },
          { environmentId: bob.environmentId, deviceId },
        )
      ).status,
    ).toBe(404);
    const impostor = new FakeDesktop(bob.key);

    impostor.environmentId = alice.environmentId;
    const crossKey = await harness.removeDevice(
      { as: "desktop", desktop: impostor },
      { environmentId: alice.environmentId, deviceId },
    );

    expect(crossKey.status).toBe(401);
    expect(
      (await harness.removeEnvironment({ as: "owner", userId: "user_bob" }, alice.environmentId))
        .status,
    ).toBe(404);
    expect(await deviceState(deviceId)).toBe("active");
    expect((await harness.lease(alice)).claims?.devices).toEqual([deviceId]);
  });

  it("rate-limits enrollments per owner", async () => {
    const desktop = await linked();
    const statuses: number[] = [];

    for (let index = 0; index < 11; index += 1)
      statuses.push(
        (
          await harness.enroll({
            userId: "user_alice",
            environmentId: desktop.environmentId,
            clientId: `phone-install-${index}-000000`,
          })
        ).status,
      );

    expect(statuses.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 201));
    expect(statuses[10]).toBe(429);
  });
});
