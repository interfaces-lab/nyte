import { EnrollResponse, ErrorBody } from "@nyte-ai/connect";
import { sha256 } from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activateDevice } from "../src/store.ts";
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
    await harness.db.prepare("SELECT state FROM devices WHERE id = ?1").bind(deviceId).first(),
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
    expect(
      await activateDevice(harness.db, {
        id: deviceId,
        environmentId: desktop.environmentId,
        clientId: "phone-install-0001",
        generation: 1,
        now: harness.now(),
      }),
    ).toBe(false);
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

    await harness.db.batch(
      Array.from({ length: 20 }, (_, index) =>
        harness.db
          .prepare(
            `INSERT INTO devices (id, environment_id, client_id, client_name, digest, session_id, state, grant_id,
               nonce, grant_expires_at, created_at)
             VALUES (?1, ?2, ?3, 'Phone', ?4, 'sess_x', 'active', ?5, 'nonce-nonce-nonce-nonce', 0, 0)`,
          )
          .bind(
            crypto.randomUUID(),
            desktop.environmentId,
            `client-${index}-0000000000`,
            "d".repeat(43),
            `grant-${index}-000000000000000000`,
          ),
      ),
    );
    const answer = await harness.enroll({
      userId: "user_alice",
      environmentId: desktop.environmentId,
    });

    expect(code(answer.body)).toBe("limit");
    expect(desktop.recorded).toEqual([]);
    expect((await harness.lease(desktop)).claims?.devices).toHaveLength(20);
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
