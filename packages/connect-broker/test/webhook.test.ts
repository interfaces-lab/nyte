import { ErrorBody } from "@nyte-ai/connect";
import { Value } from "typebox/value";
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

const code = (body: unknown) => (Value.Check(ErrorBody, body) ? body.error.code : undefined);

const updated = (input: { id: string; banned: boolean; locked?: boolean; updatedAt: number }) => ({
  type: "user.updated",
  object: "event",
  timestamp: Date.now(),
  instance_id: "ins_test",
  data: {
    object: "user",
    id: input.id,
    banned: input.banned,
    locked: input.locked ?? false,
    updated_at: input.updatedAt,
  },
});

const deleted = (id: string, timestamp = Date.now()) => ({
  type: "user.deleted",
  object: "event",
  timestamp,
  instance_id: "ins_test",
  data: { object: "user", id, deleted: true },
});

describe("Clerk webhooks", () => {
  it("refuses an unsigned, mis-signed, or stale delivery", async () => {
    const { desktop } = await harness.link({ userId: "user_alice" });
    const unsigned = await harness.send({
      method: "POST",
      path: "/v1/clerk/webhook",
      body: JSON.stringify(deleted("user_alice")),
    });

    expect(unsigned.status).toBe(401);
    const wrongSecret = await harness.webhook(deleted("user_alice"), {
      secret: `whsec_${Buffer.from("not the secret, not the secret!!").toString("base64")}`,
    });

    expect(wrongSecret.status).toBe(401);
    const stale = await harness.webhook(deleted("user_alice"), {
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });

    expect(stale.status).toBe(401);
    expect((await harness.lease(desktop)).answer.status).toBe(200);
  });

  it("stops leases and session routes for a banned owner and resumes on a newer unban", async () => {
    const { desktop } = await harness.link({ userId: "user_alice" });

    expect(
      (await harness.webhook(updated({ id: "user_alice", banned: true, updatedAt: 100 }))).status,
    ).toBe(204);
    expect(code((await harness.lease(desktop)).answer.body)).toBe("owner_disabled");
    expect(harness.relay.calls).toEqual([
      { operation: "/reset", environmentId: desktop.environmentId, deviceId: null, path: null },
    ]);
    expect(
      code(
        (await harness.enroll({ userId: "user_alice", environmentId: desktop.environmentId })).body,
      ),
    ).toBe("owner_disabled");

    await harness.webhook(updated({ id: "user_alice", banned: false, updatedAt: 50 }));
    expect(code((await harness.lease(desktop)).answer.body)).toBe("owner_disabled");

    await harness.webhook(updated({ id: "user_alice", banned: false, updatedAt: 200 }));
    expect((await harness.lease(desktop)).answer.status).toBe(200);

    await harness.webhook(
      updated({ id: "user_alice", banned: false, locked: true, updatedAt: 300 }),
    );
    expect(code((await harness.lease(desktop)).answer.body)).toBe("owner_disabled");
  });

  it("treats deletion as terminal: revokes everything and ignores later updates", async () => {
    const { desktop } = await harness.link({ userId: "user_alice" });
    const bob = await harness.link({ userId: "user_bob" });

    await harness.enroll({ userId: "user_alice", environmentId: desktop.environmentId });
    expect((await harness.webhook(deleted("user_alice"))).status).toBe(204);
    expect(code((await harness.lease(desktop)).answer.body)).toBe("revoked");
    expect(read(await harness.rows("devices"), "0", "state")).toBe("revoked");
    expect(harness.relay.calls.filter((call) => call.operation === "/revoke")).toEqual([
      { operation: "/revoke", environmentId: desktop.environmentId, deviceId: null, path: null },
    ]);

    await harness.webhook(
      updated({ id: "user_alice", banned: false, updatedAt: Date.now() + 60_000 }),
    );
    expect(
      read(
        await harness.db.prepare("SELECT status FROM owners WHERE user_id = 'user_alice'").first(),
        "status",
      ),
    ).toBe("deleted");
    expect(code((await harness.link({ userId: "user_alice" })).answer.body)).toBe("owner_disabled");
    expect((await harness.lease(bob.desktop)).answer.status).toBe(200);
  });

  it("acknowledges events it does not act on", async () => {
    const answer = await harness.webhook({
      type: "session.created",
      object: "event",
      timestamp: Date.now(),
      instance_id: "ins_test",
      data: { id: "sess_x" },
    });

    expect(answer.status).toBe(204);
  });
});
