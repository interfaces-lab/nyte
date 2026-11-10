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

describe("the scheduled sweep", () => {
  it("catches a ban whose webhook never arrived and ends the owner's relay channels", async () => {
    const { desktop } = await harness.link({ userId: "user_alice" });

    expect((await harness.lease(desktop)).answer.status).toBe(200);
    harness.clerkApi.users.set("user_alice", { banned: true, locked: false, updated_at: 100 });
    await harness.sweep();
    expect(read((await harness.lease(desktop)).answer.body, "error", "code")).toBe(
      "owner_disabled",
    );
    expect(harness.relay.calls).toContainEqual({
      operation: "/reset",
      environmentId: desktop.environmentId,
      deviceId: null,
      path: null,
    });

    harness.clerkApi.users.set("user_alice", { banned: false, locked: false, updated_at: 200 });
    await harness.sweep();
    expect((await harness.lease(desktop)).answer.status).toBe(200);
  });

  it("drops expired replay and rate rows but keeps live ones", async () => {
    await harness.link({ userId: "user_alice" });
    const replays = await harness.rows("proof_replays");
    const rates = await harness.rows("rate_limits");

    expect(replays).not.toEqual([]);
    expect(rates).not.toEqual([]);
    await harness.sweep();
    expect(await harness.rows("proof_replays")).toEqual(replays);
    expect(await harness.rows("rate_limits")).toEqual(rates);

    harness.clock.offsetMs = 2 * 86_400_000;
    await harness.sweep();
    expect(await harness.rows("proof_replays")).toEqual([]);
    expect(await harness.rows("rate_limits")).toEqual([]);
  });

  it("never lets a denial lapse before Clerk confirms it", async () => {
    await harness.db
      .prepare(
        "INSERT INTO denied_sessions (session_id, user_id, denied_at, next_attempt_at, attempts) VALUES ('sess_stuck', 'user_alice', 0, 0, 30)",
      )
      .run();
    harness.clock.offsetMs = 400 * 86_400_000;
    await harness.sweep();
    expect(harness.clerkApi.calls).toEqual([]);
    expect(await harness.rows("denied_sessions")).toHaveLength(1);
  });
});
