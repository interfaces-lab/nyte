import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { envelope } from "@nyte-ai/core/store";
import { describe, expect, it } from "vitest";
import { postgresStore } from "../src/index.ts";
import type { PostgresClient, PostgresPool } from "../src/index.ts";
import { storeConformance, storeMigrationConformance } from "./store-conformance.ts";

true satisfies Pool extends PostgresPool ? true : false;

function pglitePool(): PostgresPool & { readonly lent: () => number } {
  const database = new PGlite();
  let queue: Promise<void> = Promise.resolve();
  let lent = 0;

  return {
    lent: () => lent,
    connect() {
      const previous = queue;
      let release = (): void => undefined;
      queue = new Promise((resolve) => {
        release = resolve;
      });

      return previous.then((): PostgresClient => {
        lent += 1;
        let released = false;

        return {
          async query(text, values) {
            const { rows } = await database.query<Record<string, unknown>>(
              text,
              values === undefined ? undefined : [...values],
            );

            return { rows };
          },
          release() {
            if (released) return;
            released = true;
            release();
          },
        };
      });
    },
    end: () => database.close(),
  };
}

storeConformance("postgresStore over pglite", async () => {
  const pool = pglitePool();
  const store = postgresStore({ pool });

  return {
    open: () => store.open(),
    close: async () => {
      await store.close();
      await pool.end();
    },
  };
});

storeMigrationConformance("postgresStore migrations over pglite", async () => {
  const pool = pglitePool();
  const store = postgresStore({ pool });

  const query = async (sql: string, values?: readonly (string | number)[]) => {
    const client = await pool.connect();

    try {
      return (await client.query(sql, values)).rows;
    } finally {
      client.release();
    }
  };

  return {
    dialect: "postgres",
    store,
    exec: async (sql, values) => {
      await query(sql, values);
    },
    rows: (sql) => query(sql),
    close: async () => {
      await store.close();
      await pool.end();
    },
  };
});

describe("postgresStore", () => {
  it("publishes opposite-order session batches and leaves both index versions unchanged after a failed compare-and-set", async () => {
    const pool = pglitePool();
    const firstStore = postgresStore({ pool });
    const secondStore = postgresStore({ pool });

    try {
      const first = await firstStore.open();
      const second = await secondStore.open();

      for (const id of ["a", "b"]) {
        const target = await first.objects.put(
          envelope(
            "session",
            {
              id,
              name: id,
              parent: null,
              origin: null,
              workspace: "w",
              pinned: false,
              archived: false,
              createdAt: 1,
              lastActivityAt: 1,
              heads: [],
              prompt: null,
            },
            1,
          ),
        );
        await first.refs.set([{ name: `sessions/${id}`, target }]);
      }
      const before = await first.sessions.list({ parents: { kind: "all" }, limit: 10 });
      const target = await first.objects.put({ marker: "tip" });
      const outcomes = await Promise.all([
        first.refs.set([
          { name: "sessions/a/heads/one", target },
          { name: "sessions/b/heads/one", target },
        ]),
        second.refs.set([
          { name: "sessions/b/heads/two", target },
          { name: "sessions/a/heads/two", target },
        ]),
      ]);
      expect(outcomes.map((outcome) => outcome.kind)).toEqual(["set", "set"]);
      expect((await first.refs.list("sessions/")).map((ref) => ref.name)).toEqual([
        "sessions/a",
        "sessions/a/heads/one",
        "sessions/a/heads/two",
        "sessions/b",
        "sessions/b/heads/one",
        "sessions/b/heads/two",
      ]);
      const current = await first.sessions.list({ parents: { kind: "all" }, limit: 10 });
      expect(current.map((row) => row.ref)).toEqual(before.map((row) => row.ref));
      expect(current[0]?.version).not.toBe(before[0]?.version);
      expect(current[1]?.version).not.toBe(before[1]?.version);
      expect(
        await second.refs.set([
          { name: "sessions/a/heads/three", target },
          { name: "sessions/b/heads/one", target, expect: "absent" },
        ]),
      ).toMatchObject({ kind: "stale", name: "sessions/b/heads/one" });
      expect(await first.refs.get("sessions/a/heads/three")).toBeNull();
      expect(await first.sessions.list({ parents: { kind: "all" }, limit: 10 })).toEqual(current);
    } finally {
      await firstStore.close();
      await secondStore.close();
      await pool.end();
    }
  });

  it("leaves the caller's pool open on close and creates its tables once", async () => {
    const pool = pglitePool();
    const store = postgresStore({ pool });
    const first = await store.open();
    const second = await store.open();

    expect(second).toBe(first);
    await store.close();
    const reopened = await postgresStore({ pool }).open();
    const target = await reopened.objects.put({ again: true });

    expect(await reopened.objects.get(target)).toEqual({ again: true });
    expect(pool.lent()).toBeGreaterThan(0);
    await pool.end();
  });
});
