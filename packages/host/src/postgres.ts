import { asSeq } from "@nyte-ai/schema";
import type { Ref, RefUpdate, Revision, Seq, SessionId, SetOutcome } from "@nyte-ai/schema";
import { blobId, objectId } from "@nyte-ai/core";
import type { Store, StoreConnection } from "@nyte-ai/core";
import { Pool } from "pg";
import {
  admits,
  collect,
  decodeEvent,
  decodeObject,
  eventsOf,
  memoryReader,
  mintRevision,
  numberOf,
  prefixEnd,
  refOf,
  setSeq,
  textOf,
} from "./store-rows.ts";

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

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, body TEXT NULL, bytes BYTEA NULL)",
  'CREATE TABLE IF NOT EXISTS refs (name TEXT COLLATE "C" PRIMARY KEY, target TEXT NULL, revision TEXT NOT NULL)',
  "CREATE TABLE IF NOT EXISTS log (session TEXT NOT NULL, seq BIGINT NOT NULL, at BIGINT NOT NULL, event TEXT NOT NULL, PRIMARY KEY (session, seq))",
];

/** Returns a `Store` (`kind: "postgres"`) over Postgres: a `pg` `Pool` of its own from `connectionString`, ended by `close()`, or the caller's `pool` (any `PostgresPool`, §41c), left open. The first `open()` creates the sqlite store's three tables if absent, `bytes` as `BYTEA`, `seq`/`at` as `BIGINT` and `refs.name` collated `"C"` so `list` ranges and orders by code point as the other stores do. Semantics are the sqlite store's (§41f); each `refs.set` is one transaction on one pooled client that first takes `pg_advisory_xact_lock` on every ref name and session it touches, in sorted order (a row lock cannot hold an absent ref or a session's next seq), then reads those refs, checks every `expect` against them, and applies and appends as the sqlite store does, rolling back on any error. Every `open()` returns a connection whose reads go through the pool. */
export function postgresStore(
  input: { readonly connectionString: string } | { readonly pool: PostgresPool },
): Store {
  const pool: PostgresPool =
    "pool" in input ? input.pool : new Pool({ connectionString: input.connectionString });

  let ready: Promise<StoreConnection> | null = null;

  return {
    kind: "postgres",
    open() {
      ready ??= migrate(pool).then(
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

async function migrate(pool: PostgresPool): Promise<void> {
  await withClient(pool, async (client) => {
    for (const statement of SCHEMA) await client.query(statement);
  });
}

/** Runs `work` on one pooled client and releases it, whatever `work` does. */
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

  const tailOf = async (client: PostgresClient, session: SessionId): Promise<Seq> => {
    const { rows } = await client.query("SELECT MAX(seq) AS tail FROM log WHERE session = $1", [
      session,
    ]);

    const value = rows[0]?.tail;

    return asSeq(value === null || value === undefined ? 0 : numberOf(value));
  };

  return {
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
        const body = textOf(rows[0]?.body);

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

        return row === undefined ? null : refOf(row);
      },
      async list(prefix) {
        const end = prefixEnd(prefix);

        const { rows } =
          end === null
            ? await query("SELECT name, target, revision FROM refs ORDER BY name")
            : await query(
                "SELECT name, target, revision FROM refs WHERE name >= $1 AND name < $2 ORDER BY name",
                [prefix, end],
              );

        return rows.map(refOf);
      },
      set: (updates) => withClient(pool, (client) => publish(client, updates, tailOf)),
      async log(session, after, limit) {
        const { rows } = await query(
          "SELECT seq, at, event FROM log WHERE session = $1 AND seq > $2 ORDER BY seq LIMIT $3",
          [session, after, limit],
        );

        return rows.map((row) =>
          decodeEvent(numberOf(row.seq), numberOf(row.at), textOf(row.event) ?? ""),
        );
      },
      tail: (session) => withClient(pool, (client) => tailOf(client, session)),
    },
  };
}

/** Publishes one batch in one transaction on `client`, as `postgresStore` describes. */
async function publish(
  client: PostgresClient,
  updates: readonly RefUpdate[],
  tailOf: (client: PostgresClient, session: SessionId) => Promise<Seq>,
): Promise<SetOutcome> {
  const logged = eventsOf(updates);
  const names = [...new Set(updates.map((update) => update.name))];
  const sessions = [...new Set(logged.map(({ session }) => session))];

  const locks = [
    ...names.map((name) => `ref:${name}`),
    ...sessions.map((id) => `log:${id}`),
  ].sort();

  await client.query("BEGIN");

  try {
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
        const ref = refOf(row);

        return [ref.name, ref];
      }),
    );

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
    }

    const at = Date.now();
    const tails = new Map<SessionId, number>();
    const appended: Seq[] = [];

    for (const { session, event } of logged) {
      const seq = (tails.get(session) ?? (await tailOf(client, session))) + 1;
      tails.set(session, seq);
      await client.query("INSERT INTO log (session, seq, at, event) VALUES ($1, $2, $3, $4)", [
        session,
        seq,
        at,
        JSON.stringify(event),
      ]);
      appended.push(asSeq(seq));
    }

    const seq = await setSeq(updates, appended, (session) => tailOf(client, session));
    await client.query("COMMIT");

    return { kind: "set", seq, revisions };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);

    throw error;
  }
}
