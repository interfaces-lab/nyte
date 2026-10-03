import { ErrorBody } from "@nyte-ai/connect";
import { Value } from "typebox/value";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, read } from "./harness.ts";
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

async function enrolled(): Promise<{ desktop: FakeDesktop; deviceId: string }> {
  const { desktop } = await harness.link({ userId: "user_alice" });
  const answer = await harness.enroll({
    userId: "user_alice",
    sessionId: "sess_phone",
    environmentId: desktop.environmentId,
  });

  expect(answer.status).toBe(201);

  return { desktop, deviceId: String(read(answer.body, "deviceId")) };
}

async function device(deviceId: string): Promise<unknown> {
  return harness.db
    .prepare("SELECT state, revoke_reason FROM devices WHERE id = ?1")
    .bind(deviceId)
    .first();
}

const denials = () => harness.rows("denied_sessions");

describe("releasing a device", () => {
  it("ends the device and advances the policy without touching its Clerk session", async () => {
    const { desktop, deviceId } = await enrolled();
    const before = await harness.lease(desktop);
    const answer = await harness.release(desktop, { deviceId });

    expect(answer.status).toBe(204);
    expect(answer.text).toBe("");
    expect(await device(deviceId)).toEqual({ state: "revoked", revoke_reason: "released" });
    expect(harness.relay.calls.at(-1)).toEqual({
      operation: "/reset",
      environmentId: desktop.environmentId,
      deviceId,
      path: null,
    });
    const after = await harness.lease(desktop);

    expect(after.claims?.devices).toEqual([]);
    expect(after.claims?.policy).toBeGreaterThan(before.claims?.policy ?? Infinity);
    expect(await denials()).toEqual([]);
    expect(harness.clerkApi.calls.filter((call) => call.includes("/sessions/"))).toEqual([]);
    expect(
      (
        await harness.enroll({
          userId: "user_alice",
          sessionId: "sess_phone",
          environmentId: desktop.environmentId,
        })
      ).status,
    ).toBe(201);
  });

  it("is idempotent and never clears a strong revocation", async () => {
    const { desktop, deviceId } = await enrolled();

    expect((await harness.release(desktop, { deviceId })).status).toBe(204);
    expect((await harness.release(desktop, { deviceId })).status).toBe(204);

    const second = await enrolled();

    expect(
      (
        await harness.removeDevice(
          { as: "desktop", desktop: second.desktop },
          {
            environmentId: second.desktop.environmentId,
            deviceId: second.deviceId,
          },
        )
      ).status,
    ).toBe(204);
    expect((await harness.release(second.desktop, { deviceId: second.deviceId })).status).toBe(204);
    expect(await device(second.deviceId)).toEqual({ state: "revoked", revoke_reason: "revoked" });
    expect(await denials()).toEqual([expect.objectContaining({ session_id: "sess_phone" })]);
  });

  it("accepts only the environment's proof, the exact empty body, and its own devices", async () => {
    const { desktop, deviceId } = await enrolled();
    const other = (await harness.link({ userId: "user_alice" })).desktop;
    const path = `/v1/environments/${desktop.environmentId}/devices/${deviceId}/release`;
    const jwtOnly = await harness.send({
      method: "POST",
      path,
      headers: { authorization: `Bearer ${await harness.sessionToken({ userId: "user_alice" })}` },
      body: "{}",
    });

    expect(jwtOnly.status).toBe(401);
    expect(code((await harness.release(desktop, { deviceId, body: "{ }" })).body)).toBe("invalid");
    expect(code((await harness.release(desktop, { deviceId, body: "" })).body)).toBe("invalid");
    expect((await harness.release(other, { deviceId })).status).toBe(404);
    expect((await harness.release(desktop, { deviceId: crypto.randomUUID() })).status).toBe(404);
    expect(
      (await harness.release(other, { deviceId, environmentId: desktop.environmentId })).status,
    ).toBe(401);
    expect(await device(deviceId)).toEqual({ state: "active", revoke_reason: null });
  });

  it("invalidates a reservation so the enrollment cannot activate", async () => {
    const { desktop } = await harness.link({ userId: "user_alice" });

    desktop.beforeReceipt = async () => {
      const grant = desktop.recorded.at(-1);

      expect((await harness.release(desktop, { deviceId: grant?.deviceId ?? "" })).status).toBe(
        204,
      );
    };
    const answer = await harness.enroll({
      userId: "user_alice",
      environmentId: desktop.environmentId,
    });

    expect(code(answer.body)).toBe("conflict");
    expect(await device(desktop.recorded.at(-1)?.deviceId ?? "")).toEqual({
      state: "revoked",
      revoke_reason: "released",
    });
  });
});

describe("a strong revocation after a release", () => {
  it("still denies and revokes the enrolling session, once, however often it repeats", async () => {
    const { desktop, deviceId } = await enrolled();

    expect((await harness.release(desktop, { deviceId })).status).toBe(204);
    const policy = (await harness.lease(desktop)).claims?.policy;

    for (let index = 0; index < 2; index += 1)
      expect(
        (
          await harness.removeDevice(
            { as: "owner", userId: "user_alice", sessionId: "sess_laptop" },
            {
              environmentId: desktop.environmentId,
              deviceId,
            },
          )
        ).status,
      ).toBe(204);
    expect(await device(deviceId)).toEqual({ state: "revoked", revoke_reason: "revoked" });
    expect(await denials()).toEqual([expect.objectContaining({ session_id: "sess_phone" })]);
    expect(harness.clerkApi.revoked).toEqual(["sess_phone"]);
    expect((await harness.lease(desktop)).claims?.policy).toBe(policy);
    expect(
      code(
        (
          await harness.enroll({
            userId: "user_alice",
            sessionId: "sess_phone",
            environmentId: desktop.environmentId,
          })
        ).body,
      ),
    ).toBe("session_revoked");
  });

  it("wins a race with a release in either order", async () => {
    for (const first of ["release", "revoke"] as const) {
      await harness.reset();
      const { desktop, deviceId } = await enrolled();
      const release = () => harness.release(desktop, { deviceId });
      const revoke = () =>
        harness.removeDevice(
          { as: "desktop", desktop },
          { environmentId: desktop.environmentId, deviceId },
        );
      const answers = await Promise.all(
        first === "release" ? [release(), revoke()] : [revoke(), release()],
      );

      expect(answers.map((answer) => answer.status)).toEqual([204, 204]);
      expect(await device(deviceId)).toEqual({ state: "revoked", revoke_reason: "revoked" });
      expect(await denials()).toEqual([expect.objectContaining({ session_id: "sess_phone" })]);
    }
  });

  it("also upgrades a device that was replaced", async () => {
    const { desktop, deviceId } = await enrolled();

    expect(
      (
        await harness.enroll({
          userId: "user_alice",
          sessionId: "sess_phone_2",
          environmentId: desktop.environmentId,
        })
      ).status,
    ).toBe(201);
    expect(await device(deviceId)).toEqual({ state: "revoked", revoke_reason: "replaced" });
    await harness.removeDevice(
      { as: "owner", userId: "user_alice", sessionId: "sess_laptop" },
      {
        environmentId: desktop.environmentId,
        deviceId,
      },
    );
    expect(await device(deviceId)).toEqual({ state: "revoked", revoke_reason: "revoked" });
    expect(await denials()).toEqual([expect.objectContaining({ session_id: "sess_phone" })]);
  });
});
