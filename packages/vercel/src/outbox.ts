import { sessionId, type HeadName, type SessionId } from "@nyte-ai/core";
import type { PostgresDatabase } from "@nyte-ai/core/postgres";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

export interface WakeTarget {
  readonly sessionId: SessionId;
  readonly head?: HeadName;
}

export interface Obligation extends WakeTarget {
  readonly id: string;
  readonly createdAt: number;
}

const checkObligationRows = Compile(
  Type.Array(
    Type.Object({
      id: Type.String(),
      session_id: Type.String(),
      head: Type.Union([Type.String(), Type.Null()]),
      created_at: Type.Number(),
    }),
  ),
);

export function dispatchOutbox(db: PostgresDatabase) {
  return {
    async initialize(): Promise<void> {
      await db.transaction(async (transaction) => {
        await transaction.query("SELECT pg_advisory_xact_lock(1853453414)");
        await transaction.query(`CREATE TABLE IF NOT EXISTS nyte_dispatch (
          id text PRIMARY KEY, session_id text NOT NULL, head text, created_at bigint NOT NULL,
          attempted_at bigint NOT NULL DEFAULT 0
        )`);
        await transaction.query(
          "CREATE INDEX IF NOT EXISTS nyte_dispatch_attempt ON nyte_dispatch (attempted_at, created_at, id)",
        );
      });
    },
    async record(target: WakeTarget): Promise<string> {
      const id = crypto.randomUUID();
      await db.query(
        "INSERT INTO nyte_dispatch (id, session_id, head, created_at) VALUES ($1, $2, $3, $4)",
        [id, target.sessionId, target.head ?? null, Date.now()],
      );

      return id;
    },
    async settle(id: string): Promise<void> {
      await db.query("DELETE FROM nyte_dispatch WHERE id = $1", [id]);
    },
    async claim(graceMs = 60_000, limit = 100): Promise<readonly Obligation[]> {
      if (
        !Number.isFinite(graceMs) ||
        graceMs < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 1000
      )
        throw new RangeError("Invalid outbox scan bounds");

      const now = Date.now();

      const rows = await db.query(
        `UPDATE nyte_dispatch SET attempted_at = $3 WHERE id IN (
           SELECT id FROM nyte_dispatch
           WHERE created_at <= $1 AND attempted_at <= $1
           ORDER BY attempted_at, created_at, id LIMIT $2
           FOR UPDATE SKIP LOCKED
         ) RETURNING id, session_id, head, created_at::float8 AS created_at`,
        [now - graceMs, limit, now],
      );

      if (!checkObligationRows.Check(rows))
        throw new TypeError("nyte_dispatch returned an unexpected row");

      return rows.map((row) => ({
        id: row.id,
        sessionId: sessionId(row.session_id),
        head: row.head ?? undefined,
        createdAt: row.created_at,
      }));
    },
  };
}

export type DispatchOutbox = ReturnType<typeof dispatchOutbox>;

export async function reconcileDispatch({
  outbox,
  wake,
  graceMs,
  limit,
  settleAfterMs,
}: {
  outbox: Pick<DispatchOutbox, "claim" | "settle">;
  wake: (target: WakeTarget) => Promise<void>;
  graceMs?: number;
  limit?: number;
  settleAfterMs?: number;
}): Promise<{ dispatched: number; failed: number; settled: number }> {
  if (settleAfterMs !== undefined && !(Number.isFinite(settleAfterMs) && settleAfterMs >= 0))
    throw new RangeError("Invalid outbox settle age");

  const started = Date.now();
  const obligations = await outbox.claim(graceMs, limit);
  let dispatched = 0;
  let failed = 0;
  let settled = 0;

  for (const obligation of obligations) {
    try {
      await wake({ sessionId: obligation.sessionId, head: obligation.head });
      dispatched += 1;
    } catch {
      failed += 1;
      continue;
    }

    if (settleAfterMs === undefined || obligation.createdAt > started - settleAfterMs) continue;
    await outbox.settle(obligation.id);
    settled += 1;
  }

  return { dispatched, failed, settled };
}
