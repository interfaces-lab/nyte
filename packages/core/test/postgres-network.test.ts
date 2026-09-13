import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { test } from "vitest";
import { openPostgresStore } from "../src/postgres.ts";

/** Opt in against the deployment's PostgreSQL to exercise real concurrent connections. */
test.runIf(process.env.NYTE_TEST_POSTGRES_URL !== undefined)(
  "separate network pools fence competing writers and preserve the session after reconnect",
  async () => {
    const connectionString = process.env.NYTE_TEST_POSTGRES_URL;
    assert.ok(connectionString);
    const firstStore = await openPostgresStore({ connectionString, max: 2 });
    const secondStore = await openPostgresStore({ connectionString, max: 2 });
    const id = `postgres-network-test-${randomUUID()}`;
    try {
      const first = await firstStore.create({ id });
      const second = await secondStore.open(id);
      for (let round = 0; round < 4; round += 1) {
        const name = `refs/facts/round-${String(round)}`;
        const outcomes = await Promise.all(
          Array.from({ length: 8 }, (_, index) => {
            const session = index % 2 === 0 ? first : second;
            return session.refs.update([{ name, from: null, to: String(index) }], {
              reason: "concurrent-network-write",
            });
          }),
        );
        assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
        assert.equal(await first.refs.read(name), await second.refs.read(name));
      }
      assert.deepEqual(
        (await second.events.read({ afterSeq: 0 })).map((event) => event.seq),
        [1, 2, 3, 4],
      );
      const lease = await first.leases.acquire("network-runner", 1);
      assert.ok(lease.ok);
      await setTimeout(5);
      const successor = await second.leases.acquire("network-runner", 10_000);
      assert.ok(successor.ok);
      assert.deepEqual(await first.events.append([], { lease: lease.lease }), {
        ok: false,
        reason: "fenced",
      });
      await firstStore.close();
      const reconnected = await openPostgresStore({ connectionString, max: 1 });
      try {
        const restored = await reconnected.open(id);
        assert.equal(await restored.events.last(), 4);
        assert.equal((await restored.refs.list("refs/facts/")).length, 4);
      } finally {
        await reconnected.close();
      }
    } finally {
      await secondStore.delete(id);
      await Promise.all([firstStore.close(), secondStore.close()]);
    }
  },
  60_000,
);
