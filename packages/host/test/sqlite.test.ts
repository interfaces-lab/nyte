import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { composeHost } from "@nyte-ai/core/server";
import { STORE_VERSION, envelope, memoryStore } from "@nyte-ai/core/store";
import { asId, asSeq, readHunks } from "@nyte-ai/schema";
import type { DurableEvent, Json, SessionId } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it } from "vitest";
import { sqliteStore } from "../src/index.ts";
import { chatOnly, fakeModels } from "./fixtures/fake-models.ts";
import { storeConformance } from "./store-conformance.ts";

const created: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "created" };

const session: SessionId = asId("s1");

const folders: string[] = [];

storeConformance("memoryStore", async () => memoryStore());

it("backfills existing session roots and pending work within the store migration", async () => {
  const path = join(await folder(), "nyte.db");
  const prior = new DatabaseSync(path);
  prior.exec(
    "CREATE TABLE objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL); CREATE TABLE refs (name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL); CREATE TABLE log (session TEXT NOT NULL, seq INTEGER, at INTEGER, event TEXT, PRIMARY KEY(session, seq)); CREATE TABLE store_meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL); INSERT INTO store_meta VALUES (1, 2)",
  );

  const root = envelope(
    "session",
    {
      id: "old",
      name: "Existing chat",
      parent: null,
      origin: null,
      workspace: "w",
      pinned: false,
      archived: true,
      createdAt: 1,
      lastActivityAt: 12,
      heads: [],
      prompt: null,
    },
    1,
  );

  const receipt = envelope("receipt", { id: "r", kind: "move", digest: "d", outcome: null }, 1);
  const put = prior.prepare("INSERT INTO objects(id, body) VALUES (?, ?)");
  put.run("root", JSON.stringify(root));
  put.run("receipt", JSON.stringify(receipt));
  prior.exec(
    "INSERT INTO refs VALUES ('sessions/old', 'root', 'r1'), ('sessions/old/receipts/r', 'receipt', 'r2')",
  );
  prior.close();
  const store = sqliteStore({ path });

  try {
    const connection = await store.open();
    expect(
      (await connection.sessions.list({ parents: { kind: "all" }, limit: 10 })).map(
        (row) => row.ref.name,
      ),
    ).toEqual(["sessions/old"]);
    expect((await connection.sessions.work({ limit: 10 })).map((ref) => ref.name)).toEqual([
      "sessions/old",
    ]);
    expect((await connection.sessions.pending({ kind: "receipt" })).map((ref) => ref.name)).toEqual(
      ["sessions/old/receipts/r"],
    );
    expect(await connection.objects.get(asId("root"))).toEqual(root);
  } finally {
    await store.close();
  }
});

it.each(["activity", "sort_at"] as const)(
  "upgrades the version-3 %s index without changing canonical data, once, without a backup",
  async (column) => {
    const directory = await folder();
    const path = join(directory, "nyte.db");
    const prior = new DatabaseSync(path);
    prior.exec(
      `CREATE TABLE objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes BLOB NULL);
       CREATE TABLE refs (name TEXT PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL);
       CREATE TABLE log (session TEXT NOT NULL, seq INTEGER, at INTEGER, event TEXT, PRIMARY KEY(session, seq));
       CREATE TABLE store_meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
       INSERT INTO store_meta VALUES (1, 3);
       CREATE TABLE session_index (name TEXT PRIMARY KEY, session TEXT NOT NULL UNIQUE, parent TEXT NULL, ${column} REAL NOT NULL, version TEXT NOT NULL);
       CREATE INDEX session_index_activity ON session_index(${column}, session);
       CREATE INDEX session_index_parent_activity ON session_index(parent, ${column}, session);
       CREATE TABLE pending_work (name TEXT PRIMARY KEY, session TEXT NOT NULL, kind TEXT NOT NULL);
       CREATE INDEX pending_work_session ON pending_work(session, kind, name);
       CREATE INDEX pending_work_kind ON pending_work(kind, session, name);
       INSERT INTO session_index VALUES ('sessions/ghost', 'ghost', NULL, 0, 'ghost-version');
       INSERT INTO pending_work VALUES ('sessions/ghost/receipts/gone', 'ghost', 'receipt')`,
    );
    const put = prior.prepare("INSERT INTO objects (id, body) VALUES (?, ?)");
    const putRef = prior.prepare("INSERT INTO refs (name, target, revision) VALUES (?, ?, ?)");

    for (const [id, at, parent] of [
      ["a", 1, null],
      ["b", 12, null],
      ["c", 12, "b"],
    ] as const) {
      put.run(
        id,
        JSON.stringify(
          envelope(
            "session",
            {
              id,
              name: id,
              parent,
              origin: null,
              workspace: "w",
              pinned: false,
              archived: false,
              createdAt: 1,
              lastActivityAt: at,
              heads: [],
              prompt: null,
            },
            1,
          ),
        ),
      );
      putRef.run(`sessions/${id}`, id, `revision-${id}`);
    }

    put.run(
      "receipt",
      JSON.stringify(envelope("receipt", { id: "r", kind: "move", digest: "d", outcome: null }, 1)),
    );
    putRef.run("sessions/b/receipts/r", "receipt", "receipt-version");
    prior.prepare("INSERT INTO log VALUES (?, ?, ?, ?)").run("a", 1, 2, JSON.stringify(created));

    const canonical = {
      objects: prior.prepare("SELECT * FROM objects ORDER BY id").all(),
      refs: prior.prepare("SELECT * FROM refs ORDER BY name").all(),
      log: prior.prepare("SELECT * FROM log ORDER BY session, seq").all(),
    };

    prior.close();
    const store = sqliteStore({ path });

    try {
      const connection = await store.open();
      expect(
        (await connection.sessions.list({ parents: { kind: "all" }, limit: 10 })).map(
          ({ ref }) => ref.name,
        ),
      ).toEqual(["sessions/b", "sessions/c", "sessions/a"]);
      expect(
        (
          await connection.sessions.list({
            parents: { kind: "all" },
            after: { at: 12, id: asId("b") },
            limit: 10,
          })
        ).map(({ ref }) => ref.name),
      ).toEqual(["sessions/c", "sessions/a"]);
      expect(
        (
          await connection.sessions.list({
            parents: { kind: "children", session: asId("b") },
            limit: 10,
          })
        ).map(({ ref }) => ref.name),
      ).toEqual(["sessions/c"]);
      expect((await connection.sessions.work({ limit: 10 })).map((ref) => ref.name)).toEqual([
        "sessions/b",
      ]);
      expect(
        (await connection.sessions.pending({ kind: "receipt" })).map((ref) => ref.name),
      ).toEqual(["sessions/b/receipts/r"]);
    } finally {
      await store.close();
    }

    const probe = new DatabaseSync(path, { readOnly: true });
    expect(probe.prepare("SELECT version FROM store_meta").get()).toEqual({
      version: STORE_VERSION,
    });
    expect({
      objects: probe.prepare("SELECT * FROM objects ORDER BY id").all(),
      refs: probe.prepare("SELECT * FROM refs ORDER BY name").all(),
      log: probe.prepare("SELECT * FROM log ORDER BY session, seq").all(),
    }).toEqual(canonical);
    probe.close();
    expect(await readdir(directory)).not.toContain("backups");
  },
);

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
  it("limits the WAL retained after a large blob and keeps the blob readable", async () => {
    const path = join(await folder(), "nyte.db");
    const store = sqliteStore({ path });

    try {
      const { objects } = await store.open();

      const id = await objects.putBlob(
        (async function* () {
          yield new Uint8Array(40 * 1024 * 1024).fill(23);
        })(),
      );

      await objects.put({ next: true });

      expect((await stat(`${path}-wal`)).size).toBeLessThanOrEqual(32 * 1024 * 1024);
      const blob = await objects.blob(id);
      assert(blob !== null);

      expect(blob.size).toBe(41943040);

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

  it("brings another host's commits on the same file to a polling host's directory and head watch", async () => {
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
    const directory = reader.sessions.watch()[Symbol.asyncIterator]();
    const views = reader.session(created.id).watch()[Symbol.asyncIterator]();
    await views.next();
    await created.update({ name: "After" });
    await created.send("From the writer.");

    let listed = await directory.next();

    while (listed.done !== true && listed.value[0]?.name !== "After")
      listed = await directory.next();

    let viewed = await views.next();

    while (viewed.done !== true && viewed.value.messages.length < 2) viewed = await views.next();

    assert(listed.done !== true && viewed.done !== true);
    expect(viewed.value.messages[1]).toMatchObject({ kind: "user", content: "From the writer." });
    await directory.return?.();
    await views.return?.();
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
      log: [],
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

  it("turns stored edit patches from hunks into unified text, logged events included, once, with a backup", async () => {
    const dir = await folder();
    const path = join(dir, "nyte.db");
    const fresh = sqliteStore({ path });
    await fresh.open();
    await fresh.close();

    const hunks = [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        header: null,
        lines: [
          { kind: "remove", text: "a" },
          { kind: "add", text: "b" },
          { kind: "add", text: "c", noNewline: true },
        ],
      },
    ];

    const fields = {
      path: "a.ts",
      status: "modified",
      digest: "d1",
      kind: "text",
      added: 2,
      removed: 1,
    };

    const legacy = { ...fields, hunks };

    const outcome = { kind: "ok", content: [], output: legacy, parts: [] };
    const call = { kind: "call", parent: null, at: 1, body: { id: "c1", result: outcome } };
    const part = { kind: "part", parent: null, at: 1, body: { id: "c1", state: { outcome } } };
    const settled = {
      head: "main",
      kind: "call",
      call: "c1",
      part: "c1",
      change: "settled",
      outcome,
      changes: null,
    };
    const seeded = new DatabaseSync(path);
    const insert = seeded.prepare("INSERT INTO objects (id, body) VALUES (?, ?)");
    insert.run("old-call", JSON.stringify(call));
    insert.run("old-part", JSON.stringify(part));
    seeded.exec(
      "INSERT INTO refs VALUES ('sessions/s1/calls/c1', 'old-call', 'r1'), ('sessions/s1/parts/c1', 'old-part', 'r2')",
    );
    seeded.prepare("INSERT INTO log VALUES ('s1', 1, 5, ?)").run(JSON.stringify(settled));
    seeded.exec("UPDATE store_meta SET version = 6");
    seeded.close();

    const store = sqliteStore({ path });
    const { objects, refs } = await store.open();
    const read = async (name: string) => objects.get((await refs.get(name))?.target ?? asId(""));
    const unified = { ...fields, patch: expect.any(String) };

    expect(await read("sessions/s1/calls/c1")).toMatchObject({
      body: { id: "c1", result: { ...outcome, output: unified } },
    });
    expect(await read("sessions/s1/parts/c1")).toMatchObject({
      body: { id: "c1", state: { outcome: { ...outcome, output: unified } } },
    });
    const [event] = await refs.log(asId("s1"), asSeq(0), 10);
    assert(event?.kind === "call" && event.change === "settled" && event.outcome.kind === "ok");
    const output = event.outcome.output;
    assert(
      typeof output === "object" &&
        output !== null &&
        "patch" in output &&
        typeof output.patch === "string",
    );

    expect(output).toEqual({ ...fields, patch: output.patch });
    expect(readHunks(output.patch)).toEqual(hunks);
    await store.close();

    const backups = await readdir(join(dir, "backups"));

    expect(JSON.parse(await readFile(join(dir, "backups", backups[0] ?? ""), "utf8"))).toEqual({
      refs: [
        { name: "sessions/s1/calls/c1", target: "old-call", revision: "r1" },
        { name: "sessions/s1/parts/c1", target: "old-part", revision: "r2" },
      ],
      log: [{ session: "s1", seq: 1, event: JSON.stringify(settled) }],
    });

    const again = sqliteStore({ path });
    await again.open();
    await again.close();

    expect(await readdir(join(dir, "backups"))).toEqual(backups);
  });

  it("logs a call's name, args and class once, on its part, keeping what an intent said that its part did not", async () => {
    const path = join(await folder(), "nyte.db");
    const fresh = sqliteStore({ path });
    await fresh.open();
    await fresh.close();

    const read = { kind: "read", path: "a.ts" };

    const created = (part: string, args: Json) => ({
      head: "main",
      kind: "part",
      part,
      change: "created",
      partKind: "tool",
      placement: { kind: "transcript", role: "step" },
      state: { call: part, name: "read", args, class: read, phase: "calling" },
      version: 1,
      run: "r1",
      owner: null,
    });

    const intent = (part: string, args: Json) => ({
      head: "main",
      kind: "call",
      call: part,
      part,
      change: "intent",
      name: "read",
      args,
      class: read,
    });

    const logged = [
      created("c1", { path: "a.ts" }),
      intent("c1", { path: "a.ts" }),
      created("c2", { path: "a.ts" }),
      intent("c2", { path: "b.ts" }),
    ];

    const seeded = new DatabaseSync(path);
    const insert = seeded.prepare("INSERT INTO log VALUES ('s1', ?, 5, ?)");
    logged.forEach((event, index) => insert.run(index + 1, JSON.stringify(event)));
    seeded.exec(`INSERT INTO objects (id, body) VALUES ('o1', '{"kept":true}')`);
    seeded.exec("INSERT INTO refs VALUES ('kv/a', 'o1', 'r1')");
    seeded.exec("UPDATE store_meta SET version = 7");
    seeded.close();

    const store = sqliteStore({ path });
    const { refs } = await store.open();
    const events = await refs.log(asId("s1"), asSeq(0), 10);
    await store.close();
    const ids = { head: "main", kind: "call", change: "intent", seq: 2, at: 5 };

    expect(events).toEqual([
      { ...created("c1", { path: "a.ts" }), seq: 1, at: 5 },
      { ...ids, call: "c1", part: "c1" },
      { ...created("c2", { path: "b.ts" }), seq: 3, at: 5 },
      { ...ids, call: "c2", part: "c2", seq: 4 },
    ]);
  });

  it("forgets the old default trust of stored workspaces and keeps a declined one as its folder's, once", async () => {
    const path = join(await folder(), "nyte.db");
    const fresh = sqliteStore({ path });
    await fresh.open();
    await fresh.close();

    const workspace = (id: string, projectResources: boolean) =>
      JSON.stringify({
        kind: "workspace",
        at: 1,
        body: {
          id,
          target: { kind: "local", path: `/work/${id}` },
          identity: `identity-${id}`,
          projectResources,
          projectSources: [],
          addedBy: "local",
          createdAt: 1,
        },
      });

    const seeded = new DatabaseSync(path);
    seeded
      .prepare("INSERT INTO objects (id, body) VALUES ('trusted', ?), ('declined', ?)")
      .run(workspace("a", true), workspace("b", false));
    seeded.exec(
      "INSERT INTO refs VALUES ('workspaces/a', 'trusted', 'r1'), ('workspaces/b', 'declined', 'r2')",
    );
    seeded.exec("UPDATE store_meta SET version = 5");
    seeded.close();

    const read = async () => {
      const store = sqliteStore({ path });
      const { objects, refs } = await store.open();

      const decision = async (name: string) => {
        const target = (await refs.get(name))?.target;
        const object = target === null || target === undefined ? null : await objects.get(target);

        return object !== null && typeof object === "object" && "body" in object
          ? object.body
          : null;
      };

      const found = {
        a: await decision("workspaces/a"),
        b: await decision("workspaces/b"),
        trust: await Promise.all((await refs.list("trust/")).map((ref) => decision(ref.name))),
        revision: (await refs.get("workspaces/a"))?.revision,
      };
      await store.close();

      return found;
    };

    const first = await read();

    expect(first).toMatchObject({
      a: { id: "a" },
      b: { id: "b" },
      trust: [{ target: { kind: "local", path: "/work/b" }, trusted: false }],
    });
    expect(first.a).not.toHaveProperty("projectResources");
    expect(first.b).not.toHaveProperty("projectResources");
    expect(await read()).toEqual(first);
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
