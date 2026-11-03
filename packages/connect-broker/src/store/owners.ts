/** Owners and the Clerk sessions the broker denies. A deleted owner stays deleted. */
import type { D1Database } from "../d1.ts";
import {
  OwnerRow,
  PendingSessionRow,
  REVOKE_DEVICES,
  REVOKE_ENVIRONMENTS,
  many,
  one,
} from "./rows.ts";
import type { Owner } from "./rows.ts";

export async function findOwner(db: D1Database, userId: string): Promise<Owner | undefined> {
  return one(
    OwnerRow,
    await db.prepare("SELECT * FROM owners WHERE user_id = ?1").bind(userId).first(),
  );
}

/** Apply a Clerk `user.updated` status if it is newer than what the broker holds. */
export async function applyOwnerStatus(
  db: D1Database,
  input: {
    readonly userId: string;
    readonly status: "active" | "disabled";
    readonly version: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO owners (user_id, status, version) VALUES (?1, ?2, ?3)
       ON CONFLICT (user_id) DO UPDATE SET status = excluded.status, version = excluded.version
       WHERE owners.status != 'deleted' AND excluded.version > owners.version`,
    )
    .bind(input.userId, input.status, input.version)
    .run();
}

/**
 * Record a Clerk Backend API lookup. It is current, so it wins over anything
 * not newer; a deleted owner stays deleted.
 */
export async function recordOwnerCheck(
  db: D1Database,
  input: {
    readonly userId: string;
    readonly status: "active" | "disabled";
    readonly version: number;
    readonly now: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO owners (user_id, status, version, checked_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id) DO UPDATE SET
         status = CASE WHEN excluded.version >= owners.version THEN excluded.status ELSE owners.status END,
         version = max(owners.version, excluded.version),
         checked_at = excluded.checked_at
       WHERE owners.status != 'deleted'`,
    )
    .bind(input.userId, input.status, input.version, input.now)
    .run();
}

/** A deleted Clerk user: terminal, whatever arrives later, and every environment is revoked. */
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
    db
      .prepare(`${REVOKE_DEVICES} (SELECT id FROM environments WHERE owner_id = ?1)`)
      .bind(input.userId, input.now),
    db.prepare(`${REVOKE_ENVIRONMENTS} owner_id = ?1`).bind(input.userId, input.now),
  ]);
}

export async function sessionDenied(
  db: D1Database,
  input: { readonly sessionId: string; readonly now: number },
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS denied FROM denied_sessions WHERE session_id = ?1 AND (expires_at IS NULL OR expires_at > ?2)",
    )
    .bind(input.sessionId, input.now)
    .first();

  return row !== null && row !== undefined;
}

/** The denied session's Clerk revocation, if it is still owed. */
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

/** Clerk revocation attempts per denied session. Past this the denial is permanent. */
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

/** Clerk confirmed the session is revoked; keep denying it until `expiresAt`. */
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
