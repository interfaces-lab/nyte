import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, read } from "./harness.ts";
import type { Harness } from "./harness.ts";

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

describe("secrets", () => {
  it("keeps credentials and tokens out of D1, logs, and error answers", async () => {
    const sessionJwt = await harness.sessionToken({ userId: "user_alice" });
    const answers: string[] = [];
    const { desktop } = await harness.link({ userId: "user_alice" });

    answers.push((await harness.lease(desktop)).answer.text);
    const enrolled = await harness.enroll({
      userId: "user_alice",
      environmentId: desktop.environmentId,
    });

    answers.push(enrolled.text);
    desktop.mode = "down";
    answers.push(
      (
        await harness.enroll({
          userId: "user_alice",
          environmentId: desktop.environmentId,
          clientId: "phone-install-0002",
        })
      ).text,
    );
    harness.clerkApi.revokeStatus = 500;
    answers.push(
      (
        await harness.removeDevice(
          { as: "owner", userId: "user_alice" },
          {
            environmentId: desktop.environmentId,
            deviceId: String(read(enrolled.body, "deviceId")),
          },
        )
      ).text,
    );
    answers.push(
      (
        await harness.send({
          method: "GET",
          path: "/v1/environments",
          headers: { authorization: "Bearer x.y.z" },
        })
      ).text,
    );
    answers.push(
      (await harness.removeEnvironment({ as: "owner", userId: "user_bob" }, desktop.environmentId))
        .text,
    );
    answers.push(
      (await harness.removeEnvironment({ as: "desktop", desktop }, desktop.environmentId)).text,
    );
    answers.push(
      (await harness.webhook({ type: "user.deleted", data: {} }, { secret: "whsec_AAAA" })).text,
    );
    answers.push(
      (
        await harness.send({
          method: "GET",
          path: "/v1/environments",
          env: { BROKER_SIGNING_KEYS: "[]" },
        })
      ).text,
    );
    await harness.sweep();

    const database = JSON.stringify(
      await Promise.all(
        (
          [
            "environments",
            "devices",
            "owners",
            "denied_sessions",
            "proof_replays",
            "rate_limits",
          ] as const
        ).map((table) => harness.rows(table)),
      ),
    );
    const logs = JSON.stringify(harness.logs);
    const errors = answers.join("\n");
    expect(harness.logs.map((entry) => entry.event)).toEqual(
      expect.arrayContaining(["enroll.unreachable", "session.revoke_failed", "config.invalid"]),
    );
    expect(logs).toContain("BROKER_SIGNING_KEYS");

    for (const secret of [...harness.secrets, sessionJwt, desktop.key.d]) {
      expect(database).not.toContain(secret);
      expect(logs).not.toContain(secret);
      expect(errors).not.toContain(secret);
    }

    for (const grant of desktop.recorded) expect(logs).not.toContain(grant.digest);
  });
});
