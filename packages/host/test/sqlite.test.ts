import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { asId, asSeq } from "@nyte-ai/schema";
import type { DurableEvent, SessionId } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it } from "vitest";
import { sqliteStore } from "../src/index.ts";
import { storeConformance } from "./store-conformance.ts";

const created: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "created" };

const session: SessionId = asId("s1");

const folders: string[] = [];

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

describe("sqliteStore", () => {
  it("opens a file in WAL mode", async () => {
    const path = join(await folder(), "nyte.db");
    const store = sqliteStore({ path });
    await store.open();
    const probe = new DatabaseSync(path);

    expect(probe.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    probe.close();
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

    await refs.set([{ name: "sessions/s1/heads/main", target, event: created }]);
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

  it("rewrites records written before the fields the decoders require, once, with a backup", async () => {
    const dir = await folder();
    const path = join(dir, "nyte.db");
    const seeded = new DatabaseSync(path);

    seeded.exec(
      "CREATE TABLE objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL); CREATE TABLE refs (name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)",
    );

    const call = { kind: "call", parent: null, at: 1, body: { id: "c1", replay: "safe" } };
    const inbox = { kind: "inbox", parent: null, at: 1, body: { messages: ["m1"] } };

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

    expect(probe.prepare("SELECT name, rewritten FROM migrations").all()).toEqual([
      { name: "2026-10-12-record-fields", rewritten: 2 },
    ]);
    probe.close();

    const backups = (await readdir(join(dir, "backups"))).filter((file) => file.endsWith(".db"));

    expect(backups).toHaveLength(1);
    const backup = new DatabaseSync(join(dir, "backups", backups[0] ?? ""), { readOnly: true });

    expect(
      backup.prepare("SELECT target FROM refs WHERE name = ?").get("sessions/s1/calls/c1"),
    ).toEqual({
      target: "old-call",
    });
    backup.close();

    const again = sqliteStore({ path });
    await again.open();
    await again.close();

    expect(
      (await readdir(join(dir, "backups"))).filter((file) => file.endsWith(".db")),
    ).toHaveLength(1);
  });
});
