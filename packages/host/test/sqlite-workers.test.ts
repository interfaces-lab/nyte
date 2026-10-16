import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout } from "node:timers/promises";
import { afterEach, expect, it } from "vitest";
import { sqliteWorkers } from "../src/sqlite-workers.ts";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function setup() {
  const folder = await mkdtemp(join(tmpdir(), "nyte-sqlite-workers-"));
  folders.push(folder);
  const path = join(folder, "nyte.db");
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL");
  database.exec("CREATE TABLE values_kept (n INTEGER NOT NULL, bytes BLOB)");
  database.exec("INSERT INTO values_kept VALUES (7, NULL)");
  const workers = sqliteWorkers(database, path);

  return { database, workers, path, folder };
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (!check()) {
    if (Date.now() > deadline) throw new Error("SQLite worker did not finish");
    await setTimeout(10);
  }
}

it("runs a large read without blocking the event loop or a concurrent writer", async () => {
  const { database, workers } = await setup();

  try {
    expect(await workers.read("SELECT n FROM values_kept", [])).toEqual([{ n: 7 }]);

    const reading = workers.read(
      "WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM numbers WHERE n < 1000000) SELECT sum(n) AS total FROM numbers",
      [],
    );

    let finished = false;
    void reading.then(() => {
      finished = true;
    });
    await setTimeout(0);
    database.exec("UPDATE values_kept SET n = 8");

    expect(finished).toBe(false);
    expect(await reading).toEqual([{ total: 500000500000 }]);
    expect(await workers.read("SELECT n FROM values_kept", [])).toEqual([{ n: 8 }]);
    await expect(workers.read("UPDATE values_kept SET n = 9", [])).rejects.toThrow("readonly");
    expect(database.prepare("SELECT n FROM values_kept").get()).toEqual({ n: 8 });
  } finally {
    await workers.close();
    database.close();
  }
});

it("checkpoints a large WAL in the worker so its next write can shrink it", async () => {
  const { database, workers, path } = await setup();

  try {
    database.exec("PRAGMA journal_size_limit = 1048576");
    await until(
      () => database.prepare("PRAGMA wal_autocheckpoint").get()?.wal_autocheckpoint === 10000,
    );
    database.prepare("INSERT INTO values_kept VALUES (11, ?)").run(new Uint8Array(8 * 1024 * 1024));
    workers.check();
    await until(() => {
      const row = database.prepare("PRAGMA wal_checkpoint(NOOP)").get();

      return row?.log === row?.checkpointed;
    });
    database.exec("INSERT INTO values_kept VALUES (12, NULL)");

    expect((await stat(`${path}-wal`)).size).toBeLessThanOrEqual(1048576);
    expect(
      database.prepare("SELECT n, length(bytes) AS size FROM values_kept ORDER BY n").all(),
    ).toEqual([
      { n: 7, size: null },
      { n: 11, size: 8388608 },
      { n: 12, size: null },
    ]);
  } finally {
    await workers.close();
    database.close();
  }
});

it("rejects an in-flight read when closed and prevents further reads", async () => {
  const { database, workers } = await setup();

  try {
    expect(await workers.read("SELECT n FROM values_kept", [])).toEqual([{ n: 7 }]);

    const reading = workers.read(
      "WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM numbers WHERE n < 1000000) SELECT sum(n) AS total FROM numbers",
      [],
    );

    const rejected = expect(reading).rejects.toThrow("closed");
    await setTimeout(0);
    await workers.close();
    await rejected;

    await expect(workers.read("SELECT n FROM values_kept", [])).rejects.toThrow("closed");
    expect(database.prepare("SELECT n FROM values_kept").get()).toEqual({ n: 7 });
  } finally {
    await workers.close();
    database.close();
  }
});

it("falls back after worker startup fails, keeping the writer usable", async () => {
  const { database, workers: original, folder } = await setup();
  await original.close();
  const workers = sqliteWorkers(database, join(folder, "missing", "nyte.db"));

  try {
    expect(await workers.read("SELECT n FROM values_kept", [])).toBeUndefined();
    expect(await workers.read("SELECT n FROM values_kept", [])).toBeUndefined();
    database.exec("INSERT INTO values_kept VALUES (13, NULL)");

    expect(database.prepare("SELECT n FROM values_kept ORDER BY n").all()).toEqual([
      { n: 7 },
      { n: 13 },
    ]);
    expect(database.prepare("PRAGMA wal_autocheckpoint").get()).toEqual({
      wal_autocheckpoint: 1000,
    });
  } finally {
    await workers.close();
    database.close();
  }
});
