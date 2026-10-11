import { DatabaseSync } from "node:sqlite";
import { asId } from "@nyte-ai/schema";
import type { AdvanceReport, HeadName, RepairPage, SessionId } from "@nyte-ai/schema";
import { decodeError } from "@nyte-ai/protocol";
import type { Miniflare } from "miniflare";
import { afterAll, describe, expect, it } from "vitest";
import type { DurableObjectSql, SqlValue } from "../src/durable-object.ts";
import { NyteHost, pass, scheduleFrom } from "../src/deploy/cloudflare/worker.ts";
import type { PassHost } from "../src/deploy/cloudflare/worker.ts";
import { bundle, startWorker } from "./workerd.ts";

const main: HeadName = asId("main");

/** Returns Durable Object SQL over an in-memory `node:sqlite` database, with `transactionSync` as one `BEGIN`/`COMMIT` that rolls back on a throw: what `pass` and `NyteHost` read and write through in these tests. */
function sqlShim(): DurableObjectSql & { readonly database: DatabaseSync } {
  const database = new DatabaseSync(":memory:");

  return {
    database,
    transactionSync<T>(closure: () => T): T {
      database.exec("BEGIN");

      try {
        const result = closure();
        database.exec("COMMIT");

        return result;
      } catch (error) {
        database.exec("ROLLBACK");

        throw error;
      }
    },
    sql: {
      exec(query, ...bindings) {
        const rows = database
          .prepare(query)
          .all(
            ...bindings.map((value) =>
              value instanceof ArrayBuffer ? new Uint8Array(value) : value,
            ),
          );

        return {
          toArray: () =>
            rows.map((row) =>
              Object.fromEntries(
                Object.entries(row).map(([column, value]): [string, SqlValue] => [
                  column,
                  typeof value === "bigint"
                    ? Number(value)
                    : value instanceof Uint8Array
                      ? value.slice().buffer
                      : value,
                ]),
              ),
            ),
        };
      },
    },
  };
}

/** Returns a host for `pass` whose advances answer from `reports` by session, recording each advance, tick and repair. */
function fakeHost(input: {
  readonly reports: Readonly<Record<string, AdvanceReport | Error>>;
  readonly runnable?: readonly { readonly session: SessionId; readonly head: HeadName }[];
  readonly during?: (session: SessionId) => void;
}): PassHost & { readonly advanced: SessionId[]; readonly ticks: number[]; repairs: number } {
  const advanced: SessionId[] = [];
  const ticks: number[] = [];

  const host = {
    advanced,
    ticks,
    repairs: 0,
    kernel: {
      waits: {
        tick: async (now: number) => {
          ticks.push(now);

          return false;
        },
      },
    },
    execution: {
      cover: async () => ({
        close: async () => undefined,
        [Symbol.asyncDispose]: async () => undefined,
      }),
      async advance({ session }: { readonly session: SessionId; readonly head: HeadName }) {
        advanced.push(session);
        input.during?.(session);
        const report = input.reports[session] ?? { kind: "idle" };

        if (report instanceof Error) throw report;

        return report;
      },
      async repair(): Promise<RepairPage> {
        host.repairs += 1;

        return { runnable: input.runnable ?? [], next: null };
      },
    },
  };

  return host;
}

/** Writes schedule rows the way a wake does. */
function due(storage: Pick<DurableObjectSql, "sql">, rows: readonly [string, number][]): void {
  storage.sql.exec(
    "CREATE TABLE IF NOT EXISTS nyte_schedule (session TEXT NOT NULL, head TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (session, head))",
  );

  for (const [session, at] of rows)
    storage.sql.exec(
      "INSERT INTO nyte_schedule (session, head, at) VALUES (?, ?, ?)",
      session,
      "main",
      at,
    );
}

function rowsOf(storage: Pick<DurableObjectSql, "sql">): Record<string, SqlValue>[] {
  return storage.sql.exec("SELECT session, at FROM nyte_schedule ORDER BY session").toArray();
}

describe("scheduleFrom", () => {
  it("maps each report to when the alarm should fire next for its head", () => {
    expect(scheduleFrom({ kind: "continue" }, 5)).toBe(5);
    expect(scheduleFrom({ kind: "waiting", until: 9 }, 5)).toBe(9);
    expect(scheduleFrom({ kind: "waiting", until: null }, 5)).toBeNull();
    expect(scheduleFrom({ kind: "retry", until: 7 }, 5)).toBe(7);
    expect(scheduleFrom({ kind: "busy", until: 8 }, 5)).toBe(8);
    expect(scheduleFrom({ kind: "idle" }, 5)).toBeNull();
    expect(scheduleFrom({ kind: "fenced" }, 5)).toBeNull();
  });
});

describe("pass (§42f, §42i)", () => {
  it("fires timers, advances the due heads and writes each report's next time", async () => {
    const storage = sqlShim();
    const now = Date.now();
    due(storage, [
      ["a", now - 2],
      ["b", now - 1],
      ["c", now - 1],
      ["d", now - 1],
      ["later", now + 60_000],
    ]);

    const host = fakeHost({
      reports: {
        a: { kind: "idle" },
        b: { kind: "waiting", until: now + 5_000 },
        c: { kind: "retry", until: now + 7_000 },
        d: new Error("boom"),
      },
    });

    const next = await pass(host, storage, { heads: 32, ms: 10_000, repair: false });
    const rows = Object.fromEntries(rowsOf(storage).map((row) => [row.session, row.at]));

    expect(host.ticks).toHaveLength(1);
    expect(host.advanced).toEqual(["a", "b", "c", "d"]);
    expect(host.repairs).toBe(0);
    expect(rows.a).toBeUndefined();
    expect(rows.b).toBe(now + 5_000);
    expect(rows.c).toBe(now + 7_000);
    expect(Number(rows.d)).toBeGreaterThanOrEqual(now + 30_000);
    expect(rows.later).toBe(now + 60_000);
    expect(next).toBe(now + 5_000);
  });

  it("advances at most budget.heads and leaves the rest due at once", async () => {
    const storage = sqlShim();
    const now = Date.now();
    due(storage, [
      ["a", now - 3],
      ["b", now - 2],
      ["c", now - 1],
    ]);
    const host = fakeHost({ reports: {} });
    const next = await pass(host, storage, { heads: 2, ms: 10_000, repair: false });

    expect(host.advanced).toEqual(["a", "b"]);
    expect(rowsOf(storage).map((row) => row.session)).toEqual(["c"]);
    expect(next).not.toBeNull();
    expect(Number(next)).toBeLessThanOrEqual(Date.now());
  });

  it("starts nothing once the time budget is spent", async () => {
    const storage = sqlShim();
    due(storage, [["a", Date.now() - 1]]);
    const host = fakeHost({ reports: {} });

    expect(await pass(host, storage, { heads: 32, ms: 0, repair: false })).not.toBeNull();
    expect(host.advanced).toEqual([]);
  });

  it("pages repair only when asked, advancing its heads that have no row", async () => {
    const storage = sqlShim();
    const runnable = [{ session: asId<"session">("owed"), head: main }];
    const host = fakeHost({ reports: { owed: { kind: "continue" } }, runnable });
    const next = await pass(host, storage, { heads: 32, ms: 10_000, repair: true });

    expect(host.repairs).toBe(1);
    expect(host.advanced).toEqual(["owed"]);
    expect(rowsOf(storage).map((row) => row.session)).toEqual(["owed"]);
    expect(next).not.toBeNull();

    const quiet = fakeHost({ reports: {}, runnable });
    await pass(quiet, sqlShim(), { heads: 32, ms: 10_000, repair: false });

    expect(quiet.repairs).toBe(0);
    expect(quiet.advanced).toEqual([]);
  });

  it("keeps a row a wake rewrote while its head was advancing", async () => {
    const storage = sqlShim();
    const now = Date.now();
    due(storage, [["a", now - 1]]);

    const host = fakeHost({
      reports: { a: { kind: "idle" } },
      during: () => {
        storage.sql.exec("UPDATE nyte_schedule SET at = ? WHERE session = ?", now + 1, "a");
      },
    });

    expect(await pass(host, storage, { heads: 32, ms: 10_000, repair: false })).toBe(now + 1);
  });
});

describe("NyteHost's cold start (§42y)", () => {
  it("sets the alarm to now though a later alarm is pending", async () => {
    const storage = sqlShim();
    const alarms: number[] = [];
    const pending = Date.now() + 3_600_000;

    const host = new NyteHost(
      {
        storage: {
          ...storage,
          getAlarm: async () => pending,
          setAlarm: async (at: number) => {
            alarms.push(at);
          },
          deleteAlarm: async () => undefined,
        },
        blockConcurrencyWhile: (callback) => callback(),
      },
      {
        NYTE_TOKEN: "a-token-of-at-least-16",
        NYTE_HOST: {
          getByName: () => ({ fetch: async () => new Response(null, { status: 500 }) }),
        },
      },
    );

    const before = Date.now();
    const described = await host.fetch(new Request("http://host.test/.nyte/describe"));

    expect(described.status).toBe(404);
    expect(alarms.some((at) => at >= before - 1_000 && at <= Date.now())).toBe(true);
  });
});

describe("the Cloudflare Worker under workerd (§42g)", () => {
  let worker: Miniflare | null = null;

  let driven: Miniflare | null = null;

  afterAll(async () => {
    await worker?.dispose();
    await driven?.dispose();
  });

  it("runs sent inputs end to end through the wake's schedule row and the alarm, without repair (§42f, §42i)", async () => {
    driven = await startWorker(
      await bundle(new URL("./fixtures/nyte-worker.ts", import.meta.url)),
      {
        NYTE_HOST: { kind: "durable-object", className: "TestHost" },
        NYTE_TOKEN: { kind: "text", value: "a-token-of-at-least-16" },
      },
    );

    const call = async (name: string, input: unknown): Promise<unknown> => {
      const response = await driven?.dispatchFetch(`http://host.test/${name}`, {
        method: "POST",
        headers: {
          Authorization: "Bearer a-token-of-at-least-16",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      expect(response?.status).toBe(200);

      return JSON.parse((await response?.text()) ?? "null");
    };

    const field = (value: unknown, name: string): unknown =>
      typeof value === "object" && value !== null && name in value
        ? Object.entries(value).find(([key]) => key === name)?.[1]
        : null;

    const session = field(await call("sessions.create", {}), "session");

    for (const content of ["Hi.", "Again."]) {
      const receipt = field(await call("head.send", { session, head: "main", content }), "receipt");

      expect(await call("receipt.settled", { session, receipt })).toMatchObject({
        kind: "completed",
      });
    }
  }, 120_000);

  it("bundles deploy/cloudflare/worker.ts, composes its host and answers through the listener", async () => {
    worker = await startWorker(
      await bundle(new URL("../src/deploy/cloudflare/worker.ts", import.meta.url)),
      {
        NYTE_HOST: { kind: "durable-object", className: "NyteHost" },
        NYTE_TOKEN: { kind: "text", value: "a-token-of-at-least-16" },
      },
    );

    const described = await worker.dispatchFetch("http://host.test/.nyte/describe");

    expect(described.status).toBe(404);
    expect(decodeError(JSON.parse(await described.text()), described.status).code).toBe("unknown");

    const listed = await worker.dispatchFetch("http://host.test/sessions.list", {
      method: "POST",
      headers: {
        Authorization: "Bearer a-token-of-at-least-16",
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    expect(listed.status).toBe(200);

    const refused = await worker.dispatchFetch("http://host.test/sessions.list", {
      method: "POST",
      headers: { Authorization: "Bearer not-the-token-at-all", "Content-Type": "application/json" },
      body: "{}",
    });

    expect(refused.status).toBe(401);
  }, 120_000);
});
