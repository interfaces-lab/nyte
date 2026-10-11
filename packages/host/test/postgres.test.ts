import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { postgresStore } from "../src/index.ts";
import type { PostgresClient, PostgresPool } from "../src/index.ts";
import { storeConformance } from "./store-conformance.ts";

/** Returns a `PostgresPool` over one in-memory pglite database. Pglite is one connection, so the adapter lends one client at a time: a transaction never interleaves with another's queries. */
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
    kind: store.kind,
    open: () => store.open(),
    close: async () => {
      await store.close();
      await pool.end();
    },
  };
});

describe("postgresStore", () => {
  it("takes pg's Pool as its pool type", () => {
    const fits: Pool extends PostgresPool ? true : false = true;

    expect(fits).toBe(true);
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
