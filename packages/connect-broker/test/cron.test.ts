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
  it("revokes reservations whose grant lapsed and bumps the policy", async () => {
    const { desktop } = await harness.link({ userId: "user_alice" });
    const before = await harness.lease(desktop);

    await harness.db
      .prepare(
        `INSERT INTO devices (id, environment_id, client_id, client_name, digest, session_id, state, grant_id,
           nonce, grant_expires_at, created_at)
         VALUES (?1, ?2, 'client-0000000000000', 'Phone', ?3, 'sess_x', 'reserved', 'grant-00000000000000000000', 'nonce-0000000000000000000', ?4, ?4)`,
      )
      .bind(crypto.randomUUID(), desktop.environmentId, "d".repeat(43), harness.now() - 60_000)
      .run();
    await harness.sweep();
    expect(read(await harness.rows("devices"), "0", "state")).toBe("revoked");
    expect((await harness.lease(desktop)).claims?.policy).toBeGreaterThan(
      before.claims?.policy ?? Infinity,
    );
  });

  it("drops expired replay and rate rows but keeps live ones", async () => {
    const { desktop } = await harness.link({ userId: "user_alice" });

    await harness.lease(desktop);
    expect((await harness.rows("proof_replays")).length).toBeGreaterThan(0);
    await harness.sweep();
    expect((await harness.rows("proof_replays")).length).toBeGreaterThan(0);

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
