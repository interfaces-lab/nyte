/** Link proof replays, rate limits, and the cron purge of what has expired. */
import type { D1Database, D1PreparedStatement } from "../d1.ts";
import { CountRow, changed, one } from "./rows.ts";

/** Record a proof id. False if it was already used. */
export async function consumeProof(
  db: D1Database,
  input: { readonly key: string; readonly expiresAt: number },
): Promise<boolean> {
  return changed(
    db
      .prepare(
        "INSERT INTO proof_replays (key, expires_at) VALUES (?1, ?2) ON CONFLICT (key) DO NOTHING",
      )
      .bind(input.key, input.expiresAt),
  );
}

/** Count a request in a fixed window; the statement answers the window's count, this one included. */
export function hitStatement(
  db: D1Database,
  input: { readonly key: string; readonly windowMs: number; readonly now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count`,
    )
    .bind(input.key, input.now - (input.now % input.windowMs));
}

/** The count `hitStatement` answered. */
export function hitCount(row: unknown): number {
  return one(CountRow, row)?.count ?? Number.POSITIVE_INFINITY;
}

export async function purge(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM proof_replays WHERE expires_at < ?1").bind(now),
    db.prepare("DELETE FROM rate_limits WHERE window_start < ?1").bind(now - 86_400_000),
    db
      .prepare("DELETE FROM denied_sessions WHERE expires_at IS NOT NULL AND expires_at < ?1")
      .bind(now),
  ]);
}
