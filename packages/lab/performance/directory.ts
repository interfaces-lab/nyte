import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { MODEL, projectionFixture } from "../../core/benchmark/fixtures.ts";
import { SqlStore } from "../../core/src/kernel/sqlite.ts";
import type { SqliteConnection, SqlRow } from "../../core/src/kernel/sql.ts";
import type { Session, Store } from "../../core/src/kernel/store.ts";
import { CorruptObject } from "../../core/src/kernel/store.ts";
import { parseStoredObject } from "../../core/src/kernel/store-schemas.ts";
import { createNyte } from "../../core/src/kernel/sdk/nyte.ts";
import { parentFromFact } from "../../core/src/kernel/sdk/snapshot.ts";
import { sessionId } from "../../core/src/kernel/sdk/types.ts";
import type { SessionInfo } from "../../core/src/kernel/sdk/types.ts";
import { localEnvironmentPlugin } from "../../core/src/tools/env.ts";

const textColumn = Compile(Type.String());

const sessionCount = 180;

const commitCount = Number(process.argv[2] ?? 256);

assert.ok(Number.isSafeInteger(commitCount) && commitCount > 0 && commitCount <= 4096);

assert.equal(commitCount % 4, 0);

assert.ok(process.argv.length <= 3);

const fixture = projectionFixture(commitCount, "many-turns");

const tip = fixture.items.at(-1)?.oid;

assert.ok(tip);

const directory = await mkdtemp("/tmp/nyte-directory-demo-");

const database = new DatabaseSync(join(directory, "synthetic.db"));

const statements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();

const counters = () => ({
  sqlCalls: 0,
  sqlRows: 0,
  returnedBodyBytes: 0,
  opens: 0,
  chains: 0,
  commits: 0,
});

let counts = counters();

const measurements: Array<
  ReturnType<typeof counters> & { phase: string; elapsedMs: number; outputBytes: number }
> = [];

const statement = (text: string) => {
  const cached = statements.get(text);

  if (cached !== undefined) return cached;
  const prepared = database.prepare(text);
  statements.set(text, prepared);

  return prepared;
};

const connection: SqliteConnection = {
  run: (text, params) => {
    counts.sqlCalls++;
    statement(text).run(...params);
  },
  all: (text, params) => {
    counts.sqlCalls++;
    const rows = statement(text).all(...params);
    counts.sqlRows += rows.length;

    for (const row of rows)
      for (const [key, value] of Object.entries(row))
        if ((key === "body" || key.endsWith("_body")) && textColumn.Check(value))
          counts.returnedBodyBytes += Buffer.byteLength(value);

    return rows;
  },
  exec: (text) => {
    counts.sqlCalls++;
    database.exec(text);
  },
  transact: (fn) => transaction("BEGIN IMMEDIATE", fn),
  read: (fn) => transaction("BEGIN", fn),
  close: () => database.close(),
};

function transaction<T>(begin: string, fn: () => T): T {
  connection.exec(begin);

  try {
    const value = fn();
    connection.exec("COMMIT");

    return value;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

const raw = new SqlStore(connection);

const store: Store = {
  create: (input) => raw.create(input),
  open: async (id) => {
    counts.opens++;
    const opened = await raw.open(id);

    const session: Session = {
      ...opened,
      close: () => opened.close(),
      objects: {
        put: (input) => opened.objects.put(input),
        get: (input) => opened.objects.get(input),
        chain: async (from, options) => {
          counts.chains++;
          const page = await opened.objects.chain(from, options);
          counts.commits += page.filter((item) => item.object.kind === "commit").length;

          return page;
        },
        list: () => opened.objects.list(),
        commits: () => opened.objects.commits(),
        delete: (input) => opened.objects.delete(input),
      },
    };

    return session;
  },
  list: () => raw.list(),
  delete: (id) => raw.delete(id),
  close: () => raw.close(),
};

const makeSdk = () =>
  createNyte({
    store,
    model: MODEL,
    models: { getModel: () => MODEL, getModels: () => [MODEL], getAvailable: async () => [MODEL] },
    plugins: [localEnvironmentPlugin({ id: "directory-demo" })],
    defaultWorkspace: { kind: "local", id: "directory-demo", cwd: directory },
    trust: () => ({ kind: "inactive" }),
    streamFn: () => {
      throw new Error("This experiment must not execute model work");
    },
  });

const factQuery = `
SELECT s.id, nr.oid AS name_ref, n.body AS name_body,
       ar.oid AS archived_ref, a.body AS archived_body,
       pr.oid AS pinned_ref, p.body AS pinned_body,
       parentr.oid AS parent_ref, parent.body AS parent_body
FROM sessions s
LEFT JOIN refs nr ON nr.session_id = s.id AND nr.name = 'refs/facts/name'
LEFT JOIN objects n ON n.session_id = s.id AND n.oid = nr.oid
LEFT JOIN refs ar ON ar.session_id = s.id AND ar.name = 'refs/facts/archived'
LEFT JOIN objects a ON a.session_id = s.id AND a.oid = ar.oid
LEFT JOIN refs pr ON pr.session_id = s.id AND pr.name = 'refs/facts/pinned'
LEFT JOIN objects p ON p.session_id = s.id AND p.oid = pr.oid
LEFT JOIN refs parentr ON parentr.session_id = s.id AND parentr.name = 'refs/facts/parent'
LEFT JOIN objects parent ON parent.session_id = s.id AND parent.oid = parentr.oid
WHERE (? = 1 OR json_type(a.body, '$.value') IS NOT 'true')
  AND (? = 1 OR json_extract(parent.body, '$.value.sessionId') IS ?)
ORDER BY s.id`;

function fact(row: SqlRow, key: string) {
  const ref = row[`${key}_ref`];

  if (ref === null) return undefined;
  const oid = textColumn.Parse(ref);
  const body = row[`${key}_body`];

  if (body === null) throw new CorruptObject(oid, `is missing for refs/facts/${key}`);
  const object = parseStoredObject(textColumn.Parse(body), oid);

  if (object.kind !== "blob") throw new CorruptObject(oid, `is not the blob refs/facts/${key}`);

  return object.value;
}

function factDirectory(input: { includeArchived?: boolean; parent?: string | null } = {}) {
  return connection
    .all(factQuery, [
      input.includeArchived === true ? 1 : 0,
      input.parent === undefined ? 1 : 0,
      input.parent ?? null,
    ])
    .flatMap((row) => {
      try {
        const name = fact(row, "name");

        return [
          {
            sessionId: sessionId(textColumn.Parse(row.id)),
            name: textColumn.Check(name) ? name : undefined,
            archived: fact(row, "archived") === true,
            pinned: fact(row, "pinned") === true,
            parent: parentFromFact(fact(row, "parent")),
          },
        ];
      } catch (error) {
        // Core drops one unreadable session from the directory (sdk/reads.ts); so does this row.
        if (error instanceof CorruptObject) return [];
        throw error;
      }
    });
}

const compact = (rows: readonly SessionInfo[]) =>
  rows
    .map(({ sessionId, name, archived, pinned, parent }) => ({
      sessionId,
      name,
      archived,
      pinned,
      parent,
    }))
    .toSorted((a, b) => a.sessionId.localeCompare(b.sessionId));

async function measure<T>(phase: string, action: () => T | Promise<T>) {
  counts = counters();
  const start = performance.now();
  const value = await action();
  const elapsedMs = performance.now() - start;
  const measured = { ...counts };
  const outputBytes = Buffer.byteLength(JSON.stringify(value) ?? "null");
  measurements.push({ phase, elapsedMs, ...measured, outputBytes });

  return { value, counts: measured };
}

async function query(phase: string, input: Parameters<typeof factDirectory>[0] = {}) {
  const measured = await measure(phase, () => factDirectory(input));
  assert.equal(measured.counts.sqlCalls, 1);
  assert.equal(measured.counts.sqlRows, measured.value.length);
  assert.equal(measured.counts.opens, 0);
  assert.equal(measured.counts.chains, 0);
  assert.equal(measured.counts.commits, 0);

  return measured.value;
}

let sdk: Awaited<ReturnType<typeof createNyte>> | undefined;

try {
  const root = sessionId("synthetic-0000");
  const child = sessionId("synthetic-0012");
  const parent = { sessionId: root, runId: "synthetic-run", callId: "synthetic-call", depth: 1 };

  for (let index = 0; index < sessionCount; index++) {
    const linked = index > 0 && index % 12 === 0;

    const facts = {
      name: `Explicit ${index}`,
      pinned: index % 7 === 0,
    };

    const session = await raw.create({
      id: `synthetic-${String(index).padStart(4, "0")}`,
      initialFacts: linked ? { ...facts, parent } : facts,
    });

    await session.objects.put(fixture.items.map((item) => item.commit));
    assert.equal(
      (
        await session.refs.update([{ name: "refs/heads/main", from: null, to: tip }], {
          reason: "synthetic-seed",
        })
      ).ok,
      true,
    );
    await session.close();
  }

  const summary = {
    fixture: {
      sessions: sessionCount,
      commitsPerSession: commitCount,
      children: 14,
      backend: "direct node:sqlite through SqlStore",
      realUserData: false,
    },
    contract: "Explicit name, archived, pinned, full parent fact only. Not SessionInfo.",
    omissions: [
      "preview/fallback title",
      "activity ordering",
      "all-head status",
      "workspace",
      "activation",
      "config",
      "pagination",
      "search",
    ],
    validation:
      "Returned fact bodies use core parseStoredObject for shape/hash and require blob kind. A fact ref whose object is missing, mismatched or not a blob drops that row, as core list does; malformed JSON fails the query, as in core. SQL archive/parent filtering happens before validation; excluded corrupt facts are not validated. Parent filter assumes valid SessionParent facts.",
    counters:
      "sqlCalls includes prepare-execute/exec calls through the shared connection, including transaction statements; sqlRows counts returned rows, not rows visited. returnedBodyBytes counts returned body columns, not internal SQLite reads or wire bytes. outputBytes is JSON result size before compaction for baseline pages, null for void mutations. Timings are not desktop FPS.",
  };

  sdk = await makeSdk();
  let client = sdk;

  const cold = await measure("core-list-cold", () =>
    client.sessions.list({ includeArchived: true }),
  );

  assert.equal(cold.value.items.length, sessionCount);
  assert.equal(cold.counts.opens, sessionCount);
  assert.equal(cold.counts.commits, sessionCount * commitCount);

  const warm = await measure("core-list-warm", () =>
    client.sessions.list({ includeArchived: true }),
  );

  assert.deepEqual(compact(warm.value.items), compact(cold.value.items));
  assert.equal(warm.counts.commits, 0);
  assert.deepEqual(await query("fact-list"), compact(cold.value.items));
  assert.equal(factDirectory().find((row) => row.sessionId === root)?.name, "Explicit 0");
  assert.equal(factDirectory().find((row) => row.sessionId === root)?.pinned, true);
  assert.deepEqual(factDirectory().find((row) => row.sessionId === child)?.parent, parent);
  const roots = await query("fact-roots", { parent: null });
  const children = await query("fact-children", { parent: root });
  assert.equal(roots.length, 166);
  assert.equal(children.length, 14);
  assert.deepEqual(roots, compact(cold.value.items.filter((row) => row.parent === undefined)));
  assert.deepEqual(
    children,
    compact(cold.value.items.filter((row) => row.parent?.sessionId === root)),
  );

  await measure("core-archive-write", () =>
    client.sessions.setArchived({ sessionId: root, archived: true }),
  );
  const archived = await query("fact-list-after-archive");
  assert.equal(archived.length, 179);
  assert.equal(
    archived.some((row) => row.sessionId === root),
    false,
  );
  const included = await query("fact-list-include-archived", { includeArchived: true });
  assert.equal(included.length, 180);
  assert.equal(included.find((row) => row.sessionId === root)?.archived, true);
  const current = await measure("core-list-after-archive", () => client.sessions.list());
  assert.deepEqual(compact(current.value.items), archived);
  assert.equal(current.counts.commits, commitCount);
  const inspection = await raw.open(root);
  const seq = await inspection.events.last();
  await measure("core-repeat-archive", () =>
    client.sessions.setArchived({ sessionId: root, archived: true }),
  );
  assert.equal(await inspection.events.last(), seq);
  assert.deepEqual(await query("fact-list-repeat-archive"), archived);
  const before = await inspection.refs.read("refs/facts/archived");
  assert.ok(before);
  assert.deepEqual(
    await inspection.refs.update([{ name: "refs/facts/archived", from: null, to: null }], {
      reason: "synthetic-rejected-cas",
    }),
    { ok: false, reason: "conflict", name: "refs/facts/archived", actual: before },
  );
  assert.equal(await inspection.refs.read("refs/facts/archived"), before);
  assert.equal(await inspection.events.last(), seq);
  assert.deepEqual(await query("fact-list-rejected-cas"), archived);

  await client.sessions.rename({ sessionId: root, name: "Renamed root" });
  await client.sessions.setPinned({ sessionId: root, pinned: false });
  await client.sessions.setArchived({ sessionId: root, archived: false });
  const restored = await query("fact-list-restored");
  assert.deepEqual(
    restored.find((row) => row.sessionId === root),
    { sessionId: root, name: "Renamed root", archived: false, pinned: false, parent: undefined },
  );
  assert.deepEqual(compact((await client.sessions.list()).items), restored);
  await inspection.close();
  await client.close();
  sdk = await makeSdk();
  client = sdk;

  const reopened = await measure("core-new-sdk-persistent-listings", () =>
    client.sessions.list({ includeArchived: true }),
  );

  assert.equal(reopened.counts.commits, 0);
  assert.deepEqual(compact(reopened.value.items), restored);
  assert.deepEqual(await query("fact-list-new-sdk"), restored);

  const corrupt = async (
    id: string,
    facts: Record<string, string | boolean>,
    key: string,
    update: string,
  ) => {
    await (await raw.create({ id, initialFacts: facts })).close();
    database
      .prepare(
        `${update} WHERE session_id = ? AND oid = (SELECT oid FROM refs WHERE session_id = ? AND name = ?)`,
      )
      .run(id, id, `refs/facts/${key}`);
  };

  await corrupt(
    "synthetic-dangling",
    { name: "Dangling", archived: true },
    "archived",
    "DELETE FROM objects",
  );
  await corrupt(
    "synthetic-tampered",
    { name: "Tampered" },
    "name",
    `UPDATE objects SET body = '{"kind":"blob","value":"Changed"}'`,
  );
  assert.deepEqual(
    compact((await client.sessions.list({ includeArchived: true })).items),
    restored,
  );
  assert.deepEqual(factDirectory(), restored);
  assert.deepEqual(factDirectory({ includeArchived: true }), restored);
  process.stdout.write(
    `${JSON.stringify({ ...summary, measurements, verified: "names, pin, full parent link, root/child filters, archive exclusion/inclusion, repeated core archive event convergence, existing store CAS rejection, rename/unpin/unarchive, new SDK over persistent listings, dangling and hash-mismatched fact refs dropped like core list (unmeasured, after all phases)" }, null, 2)}\n`,
  );
} finally {
  try {
    await sdk?.close();
  } finally {
    try {
      await raw.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
