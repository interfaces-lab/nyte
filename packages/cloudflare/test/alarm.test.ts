import assert from "node:assert/strict";
import { test } from "vitest";
import { SqlStore } from "@nyte-ai/core/store";
import { createAlarmDriver } from "../src/alarm.ts";
import { sqlScan } from "../src/scan.ts";
import { sqliteFixture } from "./fixture.ts";

test("bounded scans resume after restart and retain earlier deadlines", async (context) => {
  const fixture = sqliteFixture();
  context.onTestFinished(fixture.close);
  const store = new SqlStore(fixture.connection);

  for (const id of ["a", "b", "c"]) await store.create({ id });
  const seen: string[] = [];
  let alarm = 0;

  const options = {
    scan: sqlScan(fixture.connection),
    maxHeads: 1,
    now: () => 1000,
    onError: (cause: unknown) => {
      throw cause;
    },
    arm: async (at: number) => {
      alarm = at;
    },
    advance: async (input: { sessionId: string }) => {
      assert.equal(alarm, 31_000, "watchdog precedes work");
      seen.push(input.sessionId);

      return input.sessionId === "a"
        ? ({ kind: "retry", at: 5_000 } as const)
        : ({ kind: "idle" } as const);
    },
  };

  await createAlarmDriver(options).alarm();
  assert.equal(alarm, 1001);
  await createAlarmDriver(options).alarm();
  await createAlarmDriver(options).alarm();
  const driver = createAlarmDriver(options);
  await driver.alarm();
  assert.deepEqual(seen, ["a", "b", "c"]);
  assert.equal(alarm, 1001, "a pass begun before restart is repeated");

  for (let tick = 0; tick < 4; tick += 1) await driver.alarm();
  assert.deepEqual(seen, ["a", "b", "c", "a", "b", "c"]);
  assert.equal(alarm, 5000);
});

test("an admission racing the final rearm cannot lose its wake", async (context) => {
  const fixture = sqliteFixture();
  context.onTestFinished(fixture.close);
  const store = new SqlStore(fixture.connection);
  await store.create({ id: "a" });
  const finalWrite = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let alarm = 0;

  const driver = createAlarmDriver({
    scan: sqlScan(fixture.connection),
    now: () => 1000,
    onError: (cause) => {
      throw cause;
    },
    advance: async () => ({ kind: "idle" }),
    arm: async (at) => {
      if (at === 61_000) {
        finalWrite.resolve();
        await release.promise;
      }

      alarm = at;
    },
  });

  const scanning = driver.alarm();
  await finalWrite.promise;
  let admitted = false;

  const submitting = driver.submit(async () => {
    admitted = true;
  });

  assert.equal(admitted, false);
  release.resolve();
  await Promise.all([scanning, submitting]);
  assert.equal(admitted, true);
  assert.equal(alarm, 1001);
});

test("deadline, lease, and undated wait scheduling retain their semantics", async (context) => {
  const fixture = sqliteFixture();
  context.onTestFinished(fixture.close);
  const store = new SqlStore(fixture.connection);
  await store.create({ id: "a" });

  for (const [outcome, expected] of [
    [{ kind: "busy", until: 2000 }, 2001],
    [{ kind: "waiting", until: 3000 }, 3000],
    [{ kind: "waiting" }, 61_000],
    [{ kind: "fenced" }, 2000],
    [{ kind: "finished" }, 1001],
  ] as const) {
    let alarm = 0;
    await createAlarmDriver({
      scan: sqlScan(fixture.connection),
      now: () => 1000,
      onError: (cause) => {
        throw cause;
      },
      advance: async () => outcome,
      arm: async (at) => {
        alarm = at;
      },
    }).alarm();
    assert.equal(alarm, expected);
  }
});

test("a failed head does not starve later sessions", async (context) => {
  const fixture = sqliteFixture();
  context.onTestFinished(fixture.close);
  const store = new SqlStore(fixture.connection);
  await store.create({ id: "a" });
  await store.create({ id: "b" });
  const seen: string[] = [];
  const errors: unknown[] = [];
  let alarm = 0;
  await createAlarmDriver({
    scan: sqlScan(fixture.connection),
    now: () => 1000,
    onError: (cause) => {
      errors.push(cause);
    },
    advance: async ({ sessionId }) => {
      seen.push(sessionId);

      if (sessionId === "a") throw new Error("unavailable");

      return { kind: "idle" };
    },
    arm: async (at) => {
      alarm = at;
    },
  }).alarm();
  assert.deepEqual(seen, ["a", "b"]);
  assert.equal(errors.length, 1);
  assert.equal(alarm, 31_000);
});

test("an in-flight admission cannot prevent persisted work from advancing", async (context) => {
  const fixture = sqliteFixture();
  context.onTestFinished(fixture.close);
  const store = new SqlStore(fixture.connection);
  await store.create({ id: "a" });
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let advanced = false;

  const driver = createAlarmDriver({
    scan: sqlScan(fixture.connection),
    now: () => 1000,
    onError: (cause) => {
      throw cause;
    },
    arm: async () => {},
    advance: async () => {
      advanced = true;

      return { kind: "idle" };
    },
  });

  const admitting = driver.submit(async () => {
    started.resolve();
    await finish.promise;
  });

  await started.promise;

  try {
    await driver.alarm();
    assert.equal(advanced, true);
  } finally {
    finish.resolve();
    await admitting;
  }
});

test("heads that only have queued input are scanned", async (context) => {
  const fixture = sqliteFixture();
  context.onTestFinished(fixture.close);
  const store = new SqlStore(fixture.connection);
  const session = await store.create({ id: "a" });
  const [oid] = await session.objects.put([{ kind: "blob", value: {} }]);
  assert.ok(oid);
  await session.refs.update(
    ["refs/inbox/side/next/tip", "refs/inbox/side!/steer/tip"].map((name) => ({
      name,
      from: null,
      to: oid,
    })),
    { reason: "submit" },
  );
  const seen: (string | undefined)[] = [];
  await createAlarmDriver({
    scan: sqlScan(fixture.connection),
    now: () => 1000,
    onError: (cause) => {
      throw cause;
    },
    advance: async ({ head }) => {
      seen.push(head);

      return { kind: "idle" };
    },
    arm: async () => {},
  }).alarm();
  assert.deepEqual(seen, ["main", "side", "side!"]);
});

test("a head that aborts the alarm does not starve later sessions", async (context) => {
  const fixture = sqliteFixture();
  context.onTestFinished(fixture.close);
  const store = new SqlStore(fixture.connection);
  await store.create({ id: "a" });
  await store.create({ id: "b" });
  const seen: string[] = [];

  const options = {
    scan: sqlScan(fixture.connection),
    now: () => 1000,
    onError: (cause: unknown) => {
      throw cause;
    },
    advance: async ({ sessionId }: { sessionId: string }) => {
      seen.push(sessionId);

      if (sessionId === "a") throw new Error("isolate lost");

      return { kind: "idle" } as const;
    },
    arm: async () => {},
  };

  await assert.rejects(createAlarmDriver(options).alarm());
  await createAlarmDriver(options).alarm();
  assert.deepEqual(seen, ["a", "b"]);
});

test("an admission behind a multi-tick scan wakes a fresh pass", async (context) => {
  const fixture = sqliteFixture();
  context.onTestFinished(fixture.close);
  const store = new SqlStore(fixture.connection);
  await store.create({ id: "a" });
  await store.create({ id: "b" });
  let alarm = 0;

  const driver = createAlarmDriver({
    scan: sqlScan(fixture.connection),
    maxHeads: 1,
    now: () => 1000,
    onError: (cause) => {
      throw cause;
    },
    advance: async () => ({ kind: "idle" }),
    arm: async (at) => {
      alarm = at;
    },
  });

  await driver.alarm();
  await driver.submit(async () => {});
  await driver.alarm();
  await driver.alarm();
  assert.equal(alarm, 1001);
});
