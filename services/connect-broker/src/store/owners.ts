import { Type } from "typebox";
import type { D1Database, D1PreparedStatement } from "../d1.ts";
import { OwnerRow, PendingSessionRow, RETIRE_ENVIRONMENTS, many, one } from "./rows.ts";
import type { Owner } from "./rows.ts";

export async function findOwner(db: D1Database, userId: string): Promise<Owner | undefined> {
  return one(OwnerRow, await ownerStatement(db, userId).first());
}

export function ownerStatement(db: D1Database, userId: string): D1PreparedStatement {
  return db.prepare("SELECT user_id, status, version FROM owners WHERE user_id = ?1").bind(userId);
}

export async function applyOwnerStatus(
  db: D1Database,
  input: {
    readonly userId: string;
    readonly status: "active" | "disabled";
    readonly version: number;
    readonly source: "event" | "lookup";
  },
): Promise<Owner> {
  const [, committed] = await db.batch([
    db
      .prepare(
        `INSERT INTO owners (user_id, status, version) VALUES (?1, ?2, ?3)
         ON CONFLICT (user_id) DO UPDATE SET status = excluded.status, version = excluded.version
         WHERE owners.status != 'deleted'
           AND (excluded.version > owners.version OR (?4 = 'lookup' AND excluded.version = owners.version))`,
      )
      .bind(input.userId, input.status, input.version, input.source),
    ownerStatement(db, input.userId),
  ]);

  const owner = one(OwnerRow, committed?.results[0]);

  if (owner === undefined) throw new Error("An upserted owner was not found");

  return owner;
}

export async function deleteOwner(
  db: D1Database,
  input: { readonly userId: string; readonly version: number; readonly now: number },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO owners (user_id, status, version) VALUES (?1, 'deleted', ?3)
         ON CONFLICT (user_id) DO UPDATE SET status = 'deleted', version = max(owners.version, excluded.version)`,
      )
      .bind(input.userId, input.now, input.version),
    db.prepare(`${RETIRE_ENVIRONMENTS} owner_id = ?1`).bind(input.userId, input.now),
  ]);
}

export async function ownersToReconcile(
  db: D1Database,
  input: { readonly after: string; readonly limit: number },
): Promise<{ readonly id: string; readonly version: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT e.owner_id AS id, coalesce(max(o.version), 0) AS version
       FROM environments e LEFT JOIN owners o ON o.user_id = e.owner_id
       WHERE e.state = 'active' AND e.owner_id > ?1
       GROUP BY e.owner_id ORDER BY e.owner_id LIMIT ?2`,
    )
    .bind(input.after, input.limit)
    .all();

  return many(ReconcileRow, results);
}

const ReconcileRow = Type.Object({ id: Type.String(), version: Type.Integer() });

export function deniedStatement(
  db: D1Database,
  input: { readonly sessionId: string; readonly now: number },
): D1PreparedStatement {
  return db
    .prepare(
      "SELECT 1 AS denied FROM denied_sessions WHERE session_id = ?1 AND (expires_at IS NULL OR expires_at > ?2)",
    )
    .bind(input.sessionId, input.now);
}

export async function sessionDenied(
  db: D1Database,
  input: { readonly sessionId: string; readonly now: number },
): Promise<boolean> {
  const row = await deniedStatement(db, input).first();

  return row !== null && row !== undefined;
}

export async function denySession(
  db: D1Database,
  input: { readonly sessionId: string; readonly userId: string; readonly at: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO denied_sessions (session_id, user_id, denied_at, next_attempt_at)
       VALUES (?1, ?2, ?3, ?3) ON CONFLICT (session_id) DO NOTHING`,
    )
    .bind(input.sessionId, input.userId, input.at)
    .run();
}

export async function pendingSessionRevocation(
  db: D1Database,
  sessionId: string,
): Promise<{ readonly sessionId: string; readonly attempts: number } | undefined> {
  const row = one(
    PendingSessionRow,
    await db
      .prepare(
        `SELECT session_id, attempts FROM denied_sessions
         WHERE session_id = ?1 AND clerk_revoked_at IS NULL AND attempts < ?2`,
      )
      .bind(sessionId, SESSION_REVOKE_ATTEMPTS)
      .first(),
  );

  return row === undefined ? undefined : { sessionId: row.session_id, attempts: row.attempts };
}

const SESSION_REVOKE_ATTEMPTS = 30;

export async function pendingSessionRevocations(
  db: D1Database,
  input: { readonly now: number; readonly limit: number },
): Promise<{ readonly sessionId: string; readonly attempts: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT session_id, attempts FROM denied_sessions
       WHERE clerk_revoked_at IS NULL AND next_attempt_at <= ?1 AND attempts < ?3
       ORDER BY next_attempt_at LIMIT ?2`,
    )
    .bind(input.now, input.limit, SESSION_REVOKE_ATTEMPTS)
    .all();

  return many(PendingSessionRow, results).map((row) => ({
    sessionId: row.session_id,
    attempts: row.attempts,
  }));
}

export async function confirmSessionRevoked(
  db: D1Database,
  input: { readonly sessionId: string; readonly now: number; readonly expiresAt: number },
): Promise<void> {
  await db
    .prepare(
      `UPDATE denied_sessions SET clerk_revoked_at = ?2, expires_at = ?3
       WHERE session_id = ?1 AND clerk_revoked_at IS NULL`,
    )
    .bind(input.sessionId, input.now, input.expiresAt)
    .run();
}

export async function deferSessionRevocation(
  db: D1Database,
  input: { readonly sessionId: string; readonly nextAttemptAt: number },
): Promise<void> {
  await db
    .prepare(
      `UPDATE denied_sessions SET attempts = attempts + 1, next_attempt_at = ?2
       WHERE session_id = ?1 AND clerk_revoked_at IS NULL`,
    )
    .bind(input.sessionId, input.nextAttemptAt)
    .run();
}
