import { ErrorBody } from "@nyte-ai/connect";
import { Value } from "typebox/value";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DENIAL_RETENTION_MS } from "../src/clerk.ts";
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

async function enrolled(
  sessionId = "sess_phone",
): Promise<{ desktop: FakeDesktop; deviceId: string }> {
  const { desktop } = await harness.link({ userId: "user_alice" });
  const answer = await harness.enroll({
    userId: "user_alice",
    sessionId,
    environmentId: desktop.environmentId,
  });

  expect(answer.status).toBe(201);

  return { desktop, deviceId: String(read(answer.body, "deviceId")) };
}

async function denial(sessionId: string): Promise<unknown> {
  return harness.db
    .prepare("SELECT * FROM denied_sessions WHERE session_id = ?1")
    .bind(sessionId)
    .first();
}

describe("revoking devices", () => {
  it.each(["owner", "desktop"] as const)(
    "lets the %s revoke a device, ending its relay channels and revoking its Clerk session",
    async (as) => {
      const { desktop, deviceId } = await enrolled();
      const actor =
        as === "owner"
          ? ({ as, userId: "user_alice", sessionId: "sess_laptop" } as const)
          : ({ as, desktop } as const);
      const answer = await harness.removeDevice(actor, {
        environmentId: desktop.environmentId,
        deviceId,
      });

      expect(answer.status).toBe(204);
      expect(answer.text).toBe("");
      expect(harness.relay.calls.at(-1)).toEqual({
        operation: "/reset",
        environmentId: desktop.environmentId,
        deviceId,
        path: null,
      });
      expect((await harness.lease(desktop)).claims?.devices).toEqual([]);
      expect(harness.clerkApi.revoked).toEqual(["sess_phone"]);
      const denied = await denial("sess_phone");

      expect(read(denied, "clerk_revoked_at")).toEqual(expect.any(Number));
      expect(read(denied, "expires_at")).toBe(
        Number(read(denied, "clerk_revoked_at")) + DENIAL_RETENTION_MS,
      );
      const again = await harness.enroll({
        userId: "user_alice",
        sessionId: "sess_phone",
        environmentId: desktop.environmentId,
      });

      expect(code(again.body)).toBe("session_revoked");
      expect(
        (
          await harness.enroll({
            userId: "user_alice",
            sessionId: "sess_signed_in_again",
            environmentId: desktop.environmentId,
          })
        ).status,
      ).toBe(201);
    },
  );

  it("keeps the denial until Clerk confirms, retrying from the cron", async () => {
    const { desktop, deviceId } = await enrolled();

    harness.clerkApi.revokeStatus = 503;
    expect(
      (
        await harness.removeDevice(
          { as: "desktop", desktop },
          { environmentId: desktop.environmentId, deviceId },
        )
      ).status,
    ).toBe(204);
    expect(read(await denial("sess_phone"), "expires_at")).toBe(null);
    expect(read(await denial("sess_phone"), "attempts")).toBe(1);

    harness.clock.offsetMs = 30 * 86_400_000;
    await harness.sweep();
    expect(read(await denial("sess_phone"), "expires_at")).toBe(null);

    harness.clerkApi.revokeStatus = 200;
    harness.clock.offsetMs += 2 * 86_400_000;
    await harness.sweep();
    expect(harness.clerkApi.revoked).toEqual(["sess_phone"]);
    expect(read(await denial("sess_phone"), "expires_at")).toEqual(expect.any(Number));
  });
});

describe("removing environments", () => {
  it.each(["owner", "desktop"] as const)(
    "lets the %s remove an environment: revoke, then close its relay",
    async (as) => {
      const { desktop, deviceId } = await enrolled();
      const actor =
        as === "owner" ? ({ as, userId: "user_alice" } as const) : ({ as, desktop } as const);
      const answer = await harness.removeEnvironment(actor, desktop.environmentId);

      expect(answer.status).toBe(204);
      expect(answer.text).toBe("");
      expect(code((await harness.lease(desktop)).answer.body)).toBe("revoked");
      expect(harness.relay.calls.at(-1)).toEqual({
        operation: "/revoke",
        environmentId: desktop.environmentId,
        deviceId: null,
        path: null,
      });
      expect(
        read(
          await harness.db
            .prepare("SELECT state FROM devices WHERE id = ?1")
            .bind(deviceId)
            .first(),
          "state",
        ),
      ).toBe("revoked");
      expect(code((await harness.link({ userId: "user_alice", desktop })).answer.body)).toBe(
        "revoked",
      );
      const calls = harness.relay.calls.length;

      expect((await harness.removeEnvironment(actor, desktop.environmentId)).status).toBe(204);
      expect(harness.relay.calls).toHaveLength(calls);
    },
  );

  it("frees a slot for a new link once an environment is removed", async () => {
    const desktops = await Promise.all(
      [1, 2, 3].map(async () => (await harness.link({ userId: "user_alice" })).desktop),
    );

    expect(code((await harness.link({ userId: "user_alice" })).answer.body)).toBe("limit");
    await harness.removeEnvironment(
      { as: "owner", userId: "user_alice" },
      desktops[0]?.environmentId ?? "",
    );
    expect((await harness.link({ userId: "user_alice" })).answer.status).toBe(201);
  });
});
