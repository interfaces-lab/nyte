import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { composeHost } from "@nyte-ai/core/server";
import { STORE_VERSION, memoryStore } from "@nyte-ai/core/store";
import { asId, asSeq } from "@nyte-ai/schema";
import type { DurableEvent, SessionId } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { sqliteStore } from "../src/index.ts";
import { chatOnly, fakeModels } from "./fixtures/fake-models.ts";
import { storeConformance, storeMigrationConformance } from "./store-conformance.ts";

const created: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "created" };

const session: SessionId = asId("s1");

const folders: string[] = [];

storeConformance("memoryStore", async () => memoryStore());

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), "nyte-sqlite-"));
  folders.push(made);

  return made;
}

storeConformance("sqliteStore in memory", async () => sqliteStore({ memory: true }));

storeConformance("sqliteStore on a file", async () =>
  sqliteStore({ path: join(await folder(), "nyte.db") }),
);

storeMigrationConformance("sqliteStore migrations on a file", async () => {
  const directory = await folder();
  const path = join(directory, "nyte.db");
  const store = sqliteStore({ path });

  return {
    dialect: "sqlite",
    store,
    exec: async (sql, values = []) => {
      const database = new DatabaseSync(path);
      database.prepare(sql).run(...values);
      database.close();
    },
    rows: async (sql) => {
      const database = new DatabaseSync(path, { readOnly: true });
      const rows = database.prepare(sql).all();
      database.close();

      return rows;
    },
    backups: async () => (await readdir(directory)).filter((entry) => entry === "backups"),
    close: () => store.close(),
  };
});

describe("sqliteStore", () => {
  it("limits the WAL retained after large blobs and keeps them readable", async () => {
    const path = join(await folder(), "nyte.db");
    const store = sqliteStore({ path });

    try {
      const { objects } = await store.open();

      const id = await objects.putBlob(
        (async function* () {
          yield new Uint8Array(20 * 1024 * 1024).fill(23);
        })(),
      );

      await objects.putBlob(
        (async function* () {
          yield new Uint8Array(20 * 1024 * 1024).fill(24);
        })(),
      );

      await vi.waitFor(async function writeAfterCheckpointTruncatesWal() {
        await objects.put({ next: crypto.randomUUID() });

        expect((await stat(`${path}-wal`)).size).toBeLessThanOrEqual(32 * 1024 * 1024);
      });

      const blob = await objects.blob(id);
      assert(blob !== null);

      expect(blob.size).toBe(20971520);

      for await (const bytes of blob.chunks()) {
        expect(bytes[0]).toBe(23);
        expect(bytes.at(-1)).toBe(23);
      }
    } finally {
      await store.close();
    }
  });

  it("waits for opening and worker shutdown before reopening", async () => {
    const path = join(await folder(), "nyte.db");
    const store = sqliteStore({ path });
    const first = store.open();
    const closing = store.close();
    const second = store.open();
    await Promise.all([first, closing]);

    try {
      const { objects, refs } = await second;
      const target = await objects.put({ reopened: true });
      await refs.set([{ name: "kv/reopened", target }]);

      expect(await objects.get(target)).toEqual({ reopened: true });
      expect((await refs.list("kv/"))[0]?.target).toBe(target);
    } finally {
      await store.close();
    }
  });

  it("opens a file in WAL mode", async () => {
    const path = join(await folder(), "nyte.db");
    const store = sqliteStore({ path });
    await store.open();
    const probe = new DatabaseSync(path);

    expect(probe.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    probe.close();
    await store.close();
  });

  it("opens again after a migration fails", async () => {
    const path = join(await folder(), "nyte.db");
    const setup = new DatabaseSync(path);
    setup.exec("CREATE TABLE refs (name TEXT PRIMARY KEY, target TEXT NULL)");
    setup.exec("INSERT INTO refs (name, target) VALUES ('kv/x', 'o1')");
    setup.close();
    const store = sqliteStore({ path });

    await expect(store.open()).rejects.toThrow();
    const repair = new DatabaseSync(path);
    repair.exec("DROP TABLE refs");
    repair.close();
    const { objects } = await store.open();

    expect(await objects.get(await objects.put({ n: 1 }))).toEqual({ n: 1 });
    await store.close();
  });

  it("keeps refs, objects, blobs and the log across a reopen", async () => {
    const path = join(await folder(), "nyte.db");
    const first = sqliteStore({ path });
    const { objects, refs } = await first.open();
    const target = await objects.put({ kept: true });

    const blob = await objects.putBlob(
      (async function* () {
        yield new Uint8Array([1, 2, 3]);
      })(),
    );

    await refs.set([{ name: "sessions/s1/heads/main", target, events: [created] }]);
    await first.close();

    const second = sqliteStore({ path });
    const reopened = await second.open();

    expect(await reopened.objects.get(target)).toEqual({ kept: true });
    expect((await reopened.objects.blob(blob))?.size).toBe(3);
    expect((await reopened.refs.get("sessions/s1/heads/main"))?.target).toBe(target);
    expect(await reopened.refs.log(session, asSeq(0), 10)).toMatchObject([
      { seq: 1, kind: "head", reason: "created" },
    ]);
    await second.close();
  });

  it("lets one of two connections to one file win a set under one expect", async () => {
    const path = join(await folder(), "nyte.db");
    const left = sqliteStore({ path });
    const right = sqliteStore({ path });
    const one = await left.open();
    const two = await right.open();
    const target = await one.objects.put("base");
    const first = await one.refs.set([{ name: "kv/x", target }]);
    assert(first.kind === "set");

    const outcomes = [
      await one.refs.set([{ name: "kv/x", target, expect: first.revisions[0] }]),
      await two.refs.set([{ name: "kv/x", target, expect: first.revisions[0] }]),
    ];

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["set", "stale"]);
    await left.close();
    await right.close();
  });

  it("moves its commit mark for another connection's commit, never for its own", async () => {
    const path = join(await folder(), "nyte.db");
    const left = sqliteStore({ path });
    const right = sqliteStore({ path });
    const one = await left.open();
    const two = await right.open();
    const target = await one.objects.put("base");
    const before = await one.commitMark?.();
    await one.refs.set([{ name: "kv/x", target }]);
    const own = await one.commitMark?.();
    await two.refs.set([{ name: "kv/y", target }]);

    expect(before).toBeTypeOf("number");
    expect(own).toBe(before);
    expect(await one.commitMark?.()).not.toBe(own);
    await left.close();
    await right.close();
  });

  it("brings another host's commits on the same file to a polling host's session feed and attached head", async () => {
    const path = join(await folder(), "nyte.db");

    await using stores = new AsyncDisposableStack();

    const host = (poll?: number) =>
      composeHost({
        store: stores.adopt(sqliteStore({ path }), (store) => store.close()),
        models: fakeModels().models,
        plugins: [chatOnly],
        workspace: { kind: "chat-only", locator: null },
        execution: { kind: "admit-only" },
        home: null,
        description: { name: "test", platform: "darwin", version: "0.1.0" },
        poll,
      });

    await using reader = await host(20);
    await using writer = await host();
    const { session: created } = await writer.sessions.start({ name: "Before", content: "Hi." });
    const directory = reader.server.wire.sessions(reader.principal)[Symbol.asyncIterator]();
    const attached = reader.server.wire.attach(created.id, reader.principal);
    await Promise.all([directory.next(), attached.ready()]);
    await created.update({ name: "After" });
    await created.send("From the writer.");

    let listed = await directory.next();

    while (
      listed.done !== true &&
      listed.value.tables.sessions?.upsert.some((row) => row.name === "After") !== true
    )
      listed = await directory.next();

    const window = await vi.waitFor(() => {
      const read = attached.read(asId("main"), { tail: 10 }, null);
      expect(read.order).toHaveLength(2);

      return read;
    });

    assert(listed.done !== true);
    expect(
      window.tables.messages.upsert.find((message) => message.id === window.order[1]),
    ).toMatchObject({ kind: "user", content: "From the writer." });
    await directory.return?.();
    attached.release();
  });

  it("rewrites records and logged events written before the fields the decoders require, once, with a backup", async () => {
    const dir = await folder();
    const path = join(dir, "nyte.db");
    const seeded = new DatabaseSync(path);

    seeded.exec(
      "CREATE TABLE objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL); CREATE TABLE refs (name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL); CREATE TABLE log (session TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY (session, seq))",
    );

    const call = { kind: "call", parent: null, at: 1, body: { id: "c1", replay: "safe" } };
    const inbox = { kind: "inbox", parent: null, at: 1, body: { messages: ["m1"] } };

    const hunks = [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        header: null,
        lines: [
          { kind: "remove", text: "a" },
          { kind: "add", text: "b" },
        ],
      },
    ];

    const output = {
      path: "a.ts",
      status: "modified",
      digest: "d1",
      kind: "text",
      added: 1,
      removed: 1,
      hunks,
    };

    const settled = {
      head: "main",
      kind: "call",
      call: "c1",
      part: "c1",
      change: "settled",
      outcome: { kind: "ok", content: [], output, parts: [] },
      changes: null,
    };

    seeded.prepare("INSERT INTO log VALUES ('s1', 1, 5, ?)").run(JSON.stringify(settled));

    for (const [id, object, name] of [
      ["old-call", call, "sessions/s1/calls/c1"],
      ["old-inbox", inbox, "sessions/s1/inbox"],
    ] as const) {
      seeded
        .prepare("INSERT INTO objects (id, body) VALUES (?, ?)")
        .run(id, JSON.stringify(object));
      seeded.prepare("INSERT INTO refs (name, target, revision) VALUES (?, ?, 'r0')").run(name, id);
    }

    seeded.close();

    const store = sqliteStore({ path });
    const { objects, refs } = await store.open();
    const callRef = await refs.get("sessions/s1/calls/c1");
    const inboxRef = await refs.get("sessions/s1/inbox");
    assert(callRef?.target && inboxRef?.target);

    expect(callRef.target).not.toBe("old-call");
    expect(callRef.revision).not.toBe("r0");
    expect(await objects.get(callRef.target)).toMatchObject({
      body: { id: "c1", replay: "safe", reran: null },
    });
    expect(await objects.get(inboxRef.target)).toMatchObject({
      body: { messages: ["m1"], pendingInput: [] },
    });
    await store.close();

    const probe = new DatabaseSync(path);

    expect(probe.prepare("SELECT version FROM store_meta").all()).toEqual([
      { version: STORE_VERSION },
    ]);
    probe.close();

    const backups = await readdir(join(dir, "backups"));

    expect(backups).toHaveLength(1);
    expect(JSON.parse(await readFile(join(dir, "backups", backups[0] ?? ""), "utf8"))).toEqual({
      refs: [
        { name: "sessions/s1/calls/c1", target: "old-call", revision: "r0" },
        { name: "sessions/s1/inbox", target: "old-inbox", revision: "r0" },
      ],
      objects: [
        { id: "old-call", body: JSON.stringify(call) },
        { id: "old-inbox", body: JSON.stringify(inbox) },
      ],
      log: [{ session: "s1", seq: 1, event: JSON.stringify(settled) }],
    });

    const again = sqliteStore({ path });
    await again.open();
    await again.close();

    expect(await readdir(join(dir, "backups"))).toEqual(backups);
  });

  it("opens a store an older Nyte migrated, keeping its rows, its log and its migrations table", async () => {
    const path = join(await folder(), "nyte.db");
    const seeded = new DatabaseSync(path);

    seeded.exec(
      "CREATE TABLE objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL); CREATE TABLE refs (name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL); CREATE TABLE log (session TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY (session, seq)); CREATE TABLE migrations (name TEXT PRIMARY KEY, at INTEGER NOT NULL, rewritten INTEGER NOT NULL)",
    );
    seeded.exec("INSERT INTO migrations VALUES ('2026-10-12-record-fields', 1, 0)");
    seeded.exec(
      `INSERT INTO objects (id, body) VALUES ('o1', '{"kept":true}'), ('o2', 'not json')`,
    );
    seeded.exec("INSERT INTO refs VALUES ('kv/a', 'o1', 'r1'), ('kv/b', 'o2', 'r2')");
    seeded
      .prepare("INSERT INTO log VALUES ('s1', 1, 5, ?)")
      .run(JSON.stringify({ head: null, kind: "head", from: null, to: null, reason: "created" }));
    seeded.close();

    const store = sqliteStore({ path });
    const { objects, refs } = await store.open();

    expect(await refs.get("kv/a")).toEqual({ name: "kv/a", target: "o1", revision: "r1" });
    expect(await refs.get("kv/b")).toEqual({ name: "kv/b", target: "o2", revision: "r2" });
    expect(await objects.get(asId("o1"))).toEqual({ kept: true });
    expect(await refs.log(session, asSeq(0), 10)).toMatchObject([{ seq: 1, reason: "created" }]);
    await store.close();

    const probe = new DatabaseSync(path, { readOnly: true });

    expect(probe.prepare("SELECT version FROM store_meta").get()).toEqual({
      version: STORE_VERSION,
    });
    expect(probe.prepare("SELECT name FROM migrations").all()).toEqual([
      { name: "2026-10-12-record-fields" },
    ]);
    probe.close();
  });

  it("opens one older file from two stores at once, migrating it once", async () => {
    const dir = await folder();
    const path = join(dir, "nyte.db");
    const seeded = new DatabaseSync(path);

    seeded.exec(
      "CREATE TABLE objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL); CREATE TABLE refs (name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)",
    );

    seeded
      .prepare("INSERT INTO objects (id, body) VALUES ('old-call', ?)")
      .run(JSON.stringify({ kind: "call", parent: null, at: 1, body: { id: "c1" } }));
    seeded.exec("INSERT INTO refs VALUES ('sessions/s1/calls/c1', 'old-call', 'r0')");
    seeded.close();

    const left = sqliteStore({ path });
    const right = sqliteStore({ path });
    const [one, two] = await Promise.all([left.open(), right.open()]);
    const ref = await one.refs.get("sessions/s1/calls/c1");

    expect(await two.refs.get("sessions/s1/calls/c1")).toEqual(ref);
    expect(ref?.target ? await one.objects.get(ref.target) : null).toMatchObject({
      body: { id: "c1", reran: null },
    });
    await left.close();
    await right.close();
  });

  it("refuses a store a newer Nyte migrated, before opening and before writing", async () => {
    const path = join(await folder(), "nyte.db");
    const store = sqliteStore({ path });
    const { objects, refs } = await store.open();
    const target = await objects.put("kept");
    const newer = new DatabaseSync(path);
    newer.prepare("UPDATE store_meta SET version = ?").run(STORE_VERSION + 1);
    newer.close();

    await expect(refs.set([{ name: "kv/x", target }])).rejects.toThrow(/Update Nyte/);
    expect(await refs.get("kv/x")).toBeNull();
    await store.close();

    await expect(sqliteStore({ path }).open()).rejects.toThrow(/Update Nyte/);
  });
});
