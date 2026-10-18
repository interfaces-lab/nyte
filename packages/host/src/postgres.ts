import { asSeq } from "@nyte-ai/schema";
import type {
  ObjectId,
  Ref,
  RefUpdate,
  Revision,
  Seq,
  SessionId,
  SetOutcome,
} from "@nyte-ai/schema";
import {
  admits,
  fenceNames,
  assertStoreVersion,
  blobId,
  decodeObject,
  collectSessionEvents,
  migrateStore,
  objectId,
  sessionIndexRef,
  parseSessionRef,
} from "@nyte-ai/core/store";
import type { Store, StoreConnection } from "@nyte-ai/core";
import type { MigrationTarget } from "@nyte-ai/core/store";
import { Pool } from "pg";
import {
  collect,
  decodeEvent,
  loggedRow,
  memoryReader,
  mintRevision,
  parseNumber,
  prefixEnd,
  parseRef,
  parseStoredObject,
  parseStoredRecord,
  parseText,
} from "./store-rows.ts";
import {
  postgresSessionIndexQuery,
  sessionIndexChanges,
  sqlSessionIndex,
} from "./session-index.ts";

/** Returns one pooled client: what `PostgresPool.connect` lends, a query at a time, released once. */
export type PostgresClient = {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
  release(): void;
};

/** Returns the pool `postgresStore` queries through, structurally, so `pg.Pool` and a pglite adapter both fit (§41c). */
export type PostgresPool = {
  connect(): Promise<PostgresClient>;
  end(): Promise<void>;
};

const MIGRATION_LOCK = "SELECT pg_advisory_xact_lock(hashtextextended('nyte:store', 0))";

const SHARED_MIGRATION_LOCK =
  "SELECT pg_advisory_xact_lock_shared(hashtextextended('nyte:store', 0))";

/** Returns a `Store` over Postgres: a `pg` `Pool` of its own from `connectionString`, ended by `close()`, or the caller's `pool` (any `PostgresPool`, §41c), left open. The first `open()` brings it to core's `STORE_VERSION` with `migrateStore`, the sqlite store's tables with `bytes` as `BYTEA`, `seq`/`at` as `BIGINT` and `refs.name` collated `"C"` so `list` ranges and orders by code point as the other stores do; each commit is one transaction under an exclusive advisory lock, so instances opening at once serialize, and the open rejects with `SdkError("unavailable")` for a store a newer Nyte migrated. There is no backup. Semantics are the sqlite store's (§41f); each `refs.set` is one transaction on one pooled client that shares the migration's advisory lock, rejects with `SdkError("unavailable")` when a newer Nyte has migrated the store, then takes `pg_advisory_xact_lock` on every ref name and session it touches, in sorted order (a row lock cannot hold an absent ref or a session's next seq), then reads those refs and applies `RefStore.set`, rolling back on any error. Every `open()` returns a connection whose reads go through the pool. */
export function postgresStore(
  input: { readonly connectionString: string } | { readonly pool: PostgresPool },
): Store {
  const pool: PostgresPool =
    "pool" in input ? input.pool : new Pool({ connectionString: input.connectionString });

  let ready: Promise<StoreConnection> | null = null;

  return {
    open() {
      ready ??= migrateStore(postgresTarget(pool)).then(
        () => connect(pool),
        (error: unknown) => {
          ready = null;

          throw error;
        },
      );

      return ready;
    },
    async close() {
      ready = null;

      if (!("pool" in input)) await pool.end();
    },
  };
}

async function storedVersion(client: PostgresClient): Promise<number> {
  const { rows } = await client.query("SELECT to_regclass('store_meta') IS NOT NULL AS stamped");

  if (rows[0]?.stamped !== true) return 0;
  const stamp = await client.query("SELECT version FROM store_meta WHERE id = 1");
  const version = stamp.rows[0]?.version;

  return version === undefined ? 0 : parseNumber(version);
}

function postgresTarget(pool: PostgresPool): MigrationTarget {
  return {
    dialect: "postgres",
    stamp: () =>
      withClient(pool, async (client) => {
        const version = await storedVersion(client);
        const { rows } = await client.query("SELECT to_regclass('refs') IS NOT NULL AS present");

        const empty =
          rows[0]?.present !== true ||
          (await client.query("SELECT 1 FROM refs LIMIT 1")).rows.length === 0;

        return { version, empty };
      }),
    records: async () =>
      (
        await withClient(pool, (client) =>
          client.query(
            "SELECT refs.name, refs.target, refs.revision, objects.body FROM refs JOIN objects ON objects.id = refs.target WHERE objects.body IS NOT NULL",
          ),
        )
      ).rows.map(parseStoredRecord),
    async *objects(kind) {
      const { rows } = await withClient(pool, (client) =>
        client.query(
          "SELECT id, body FROM objects WHERE body IS NOT NULL AND strpos(body, $1) > 0",
          [`"kind":${JSON.stringify(kind)}`],
        ),
      );

      yield* rows.map(parseStoredObject);
    },
    async *logs() {
      const sessions = await withClient(pool, async (client) => {
        const { rows } = await client.query("SELECT to_regclass('log') IS NOT NULL AS present");

        return rows[0]?.present === true
          ? (await client.query("SELECT DISTINCT session FROM log")).rows
          : [];
      });

      for (const row of sessions) {
        const session = parseText(row.session);

        if (session === null) continue;

        const { rows } = await withClient(pool, (client) =>
          client.query("SELECT seq, event FROM log WHERE session = $1 ORDER BY seq", [session]),
        );

        yield { session, events: rows.map(loggedRow) };
      }
    },
    commit: (change) =>
      withClient(pool, async (client) => {
        await client.query("BEGIN");

        try {
          await client.query(MIGRATION_LOCK);

          if ((await storedVersion(client)) !== change.from) {
            await client.query("ROLLBACK");

            return "moved";
          }

          for (const statement of change.sql) await client.query(statement);

          for (const moved of change.repoints) {
            await client.query(
              "INSERT INTO objects (id, body) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET body = excluded.body WHERE objects.body IS NULL",
              [moved.id, moved.body],
            );

            const { rows } = await client.query(
              "UPDATE refs SET target = $1, revision = $2 WHERE name = $3 AND revision = $4 RETURNING name",
              [moved.id, mintRevision(), moved.name, moved.expect],
            );

            if (rows.length === 0) {
              await client.query("ROLLBACK");

              return "conflict";
            }
            await updateSessionIndex(client, moved.name, moved.id, mintRevision());
          }

          for (const created of change.creates) {
            await client.query(
              "INSERT INTO objects (id, body) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET body = excluded.body WHERE objects.body IS NULL",
              [created.target, created.body],
            );
            const revision = mintRevision();

            const { rows } = await client.query(
              "INSERT INTO refs (name, target, revision) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING RETURNING name",
              [created.name, created.target, revision],
            );

            if (rows.length > 0)
              await updateSessionIndex(client, created.name, created.target, revision);
          }

          for (const relog of change.relogs) {
            const { rows } = await client.query(
              "UPDATE log SET event = $1 WHERE session = $2 AND seq = $3 AND event = $4 RETURNING seq",
              [relog.event, relog.session, relog.seq, relog.expect],
            );

            if (rows.length === 0) {
              await client.query("ROLLBACK");

              return "conflict";
            }
          }

          if (change.reindexSessions) {
            const { rows } = await client.query("SELECT name, target, revision FROM refs");

            for (const row of rows) {
              const ref = parseRef(row);
              await updateSessionIndex(client, ref.name, ref.target, ref.revision);
            }
          }

          await client.query(
            "INSERT INTO store_meta (id, version) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET version = excluded.version",
            [change.to],
          );
          await client.query("COMMIT");

          return "committed";
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);

          throw error;
        }
      }),
  };
}

async function withClient<T>(
  pool: PostgresPool,
  work: (client: PostgresClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    return await work(client);
  } finally {
    client.release();
  }
}

function connect(pool: PostgresPool): StoreConnection {
  const query = (text: string, values?: readonly unknown[]) =>
    withClient(pool, (client) => client.query(text, values));

  const readTail = async (client: PostgresClient, session: SessionId): Promise<Seq> => {
    const { rows } = await client.query("SELECT MAX(seq) AS tail FROM log WHERE session = $1", [
      session,
    ]);

    const value = rows[0]?.tail;

    return asSeq(value === null || value === undefined ? 0 : parseNumber(value));
  };

  return {
    sessions: sqlSessionIndex(
      async (text, values) => (await query(postgresSessionIndexQuery(text), values)).rows,
    ),
    objects: {
      async put(object) {
        const id = await objectId(object);
        await query(
          "INSERT INTO objects (id, body) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET body = excluded.body WHERE objects.body IS NULL",
          [id, JSON.stringify(object)],
        );

        return id;
      },
      async get(id) {
        const { rows } = await query("SELECT body FROM objects WHERE id = $1", [id]);
        const body = parseText(rows[0]?.body);

        return body === null ? null : decodeObject(body);
      },
      async putBlob(bytes) {
        const joined = await collect(bytes);
        const id = await blobId(joined);
        await query(
          "INSERT INTO objects (id, bytes) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET bytes = excluded.bytes WHERE objects.bytes IS NULL",
          [id, joined],
        );

        return id;
      },
      async blob(id) {
        const { rows } = await query("SELECT bytes FROM objects WHERE id = $1", [id]);
        const bytes = rows[0]?.bytes;

        return bytes instanceof Uint8Array ? memoryReader(new Uint8Array(bytes)) : null;
      },
    },
    refs: {
      async get(name) {
        const { rows } = await query("SELECT name, target, revision FROM refs WHERE name = $1", [
          name,
        ]);

        const row = rows[0];

        return row === undefined ? null : parseRef(row);
      },
      async list(prefix) {
        const end = prefixEnd(prefix);

        const { rows } =
          end === null
            ? await query(
                "SELECT name, target, revision FROM refs WHERE name >= $1 ORDER BY name",
                [prefix],
              )
            : await query(
                "SELECT name, target, revision FROM refs WHERE name >= $1 AND name < $2 ORDER BY name",
                [prefix, end],
              );

        return rows.map(parseRef);
      },
      set: (updates) => withClient(pool, (client) => publish(client, updates, readTail)),
      async log(session, after, limit) {
        const { rows } = await query(
          "SELECT seq, at, event FROM log WHERE session = $1 AND seq > $2 ORDER BY seq LIMIT $3",
          [session, after, limit],
        );

        return rows.map((row) =>
          decodeEvent(parseNumber(row.seq), parseNumber(row.at), parseText(row.event) ?? ""),
        );
      },
      tail: (session) => withClient(pool, (client) => readTail(client, session)),
    },
  };
}

async function publish(
  client: PostgresClient,
  updates: readonly RefUpdate[],
  readTail: (client: PostgresClient, session: SessionId) => Promise<Seq>,
): Promise<SetOutcome> {
  const logged = collectSessionEvents(updates);
  const fences = fenceNames(updates);
  const names = [...new Set([...updates.map((update) => update.name), ...fences])];
  const sessions = [
    ...new Set(
      updates.flatMap(({ name }) => {
        const session = parseSessionRef(name);

        return session === null ? [] : [session];
      }),
    ),
  ];

  const locks = [
    ...names.map((name) => `ref:${name}`),
    ...sessions.map((id) => `log:${id}`),
  ].sort();

  await client.query("BEGIN");

  try {
    await client.query(SHARED_MIGRATION_LOCK);
    assertStoreVersion(await storedVersion(client));

    for (const key of locks)
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);

    const { rows } =
      names.length === 0
        ? { rows: [] }
        : await client.query(
            `SELECT name, target, revision FROM refs WHERE name IN (${names.map((_, index) => `$${index + 1}`).join(", ")})`,
            names,
          );

    const before = new Map<string, Ref>(
      rows.map((row) => {
        const ref = parseRef(row);

        return [ref.name, ref];
      }),
    );

    const fenced = fences.find((name) => !before.has(name));

    if (fenced !== undefined) {
      await client.query("ROLLBACK");

      return { kind: "fenced", name: fenced };
    }

    const stale = updates.find((update) => !admits(update, before.get(update.name)));

    if (stale !== undefined) {
      await client.query("ROLLBACK");

      return {
        kind: "stale",
        name: stale.name,
        revision: before.get(stale.name)?.revision ?? null,
      };
    }

    const revisions: Revision[] = [];
    const touched = new Map<SessionId, Revision>();

    for (const update of updates) {
      const revision = mintRevision();
      revisions.push(revision);

      if (update.target === null)
        await client.query("DELETE FROM refs WHERE name = $1", [update.name]);
      else
        await client.query(
          "INSERT INTO refs (name, target, revision) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET target = excluded.target, revision = excluded.revision",
          [update.name, update.target, revision],
        );
      await updateSessionIndex(client, update.name, update.target, revision);
      const session = parseSessionRef(update.name);

      if (session !== null) touched.set(session, revision);
    }

    for (const [session, version] of touched)
      await client.query("UPDATE session_index SET version = $1 WHERE session = $2", [
        version,
        session,
      ]);

    const at = Date.now();
    const tails = new Map<SessionId, number>();
    const appended: Seq[] = [];

    for (const { session, event } of logged) {
      const seq = (tails.get(session) ?? (await readTail(client, session))) + 1;
      tails.set(session, seq);
      await client.query("INSERT INTO log (session, seq, at, event) VALUES ($1, $2, $3, $4)", [
        session,
        seq,
        at,
        JSON.stringify(event),
      ]);
      appended.push(asSeq(seq));
    }

    await client.query("COMMIT");

    return { kind: "set", logged: appended, at, revisions };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);

    throw error;
  }
}

async function updateSessionIndex(
  client: PostgresClient,
  name: string,
  target: ObjectId | null,
  revision: Revision,
): Promise<void> {
  if (sessionIndexRef(name) === null) return;
  const body =
    target === null
      ? null
      : parseText(
          (await client.query("SELECT body FROM objects WHERE id = $1", [target])).rows[0]?.body,
        );

  for (const change of sessionIndexChanges(
    name,
    body === null ? null : decodeObject(body),
    revision,
  ))
    await client.query(postgresSessionIndexQuery(change.text), change.values);
}
