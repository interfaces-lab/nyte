/**
 * Devices: reservations, activation, the two ways a device ends, and the cron
 * expiry of unconfirmed reservations. Each change a lease reflects bumps the
 * environment's `policy` in the same batch.
 */
import { DEVICE_LIMIT } from "@nyte-ai/connect";
import type { D1Database } from "../d1.ts";
import { DeviceRow, changed, one } from "./rows.ts";
import type { Device } from "./rows.ts";

/**
 * Reserve a device before the broker forwards its enrollment. Fails when the
 * environment is not the owner's and active, or is at `DEVICE_LIMIT` counting
 * reservations and every active device but the one this client replaces.
 */
export async function reserveDevice(
  db: D1Database,
  input: {
    readonly id: string;
    readonly environmentId: string;
    readonly ownerId: string;
    readonly clientId: string;
    readonly clientName: string;
    readonly digest: string;
    readonly sessionId: string;
    readonly grantId: string;
    readonly nonce: string;
    readonly grantExpiresAt: number;
    readonly now: number;
  },
): Promise<boolean> {
  return changed(
    db
      .prepare(
        `INSERT INTO devices
           (id, environment_id, client_id, client_name, digest, session_id, state, grant_id, nonce,
            grant_expires_at, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'reserved', ?7, ?8, ?9, ?10
         WHERE EXISTS (SELECT 1 FROM environments WHERE id = ?2 AND owner_id = ?11 AND state = 'active')
           AND (SELECT count(*) FROM devices
                WHERE environment_id = ?2
                  AND (state = 'reserved' OR (state = 'active' AND client_id != ?3))) < ?12`,
      )
      .bind(
        input.id,
        input.environmentId,
        input.clientId,
        input.clientName,
        input.digest,
        input.sessionId,
        input.grantId,
        input.nonce,
        input.grantExpiresAt,
        input.now,
        input.ownerId,
        DEVICE_LIMIT,
      ),
  );
}

/**
 * Compare-and-set a reservation to active, replacing the client's earlier
 * device, only while the reservation is unexpired and unrevoked, its Clerk
 * session is not denied, and the environment is active at the generation the
 * grant named.
 */
export async function activateDevice(
  db: D1Database,
  input: {
    readonly id: string;
    readonly environmentId: string;
    readonly clientId: string;
    readonly generation: number;
    readonly now: number;
  },
): Promise<boolean> {
  const live = `EXISTS (SELECT 1 FROM devices
      WHERE id = ?1 AND environment_id = ?2 AND state = 'reserved' AND grant_expires_at >= ?4
        AND session_id NOT IN (SELECT session_id FROM denied_sessions))
    AND EXISTS (SELECT 1 FROM environments WHERE id = ?2 AND state = 'active' AND generation = ?5)`;

  const results = await db.batch([
    db
      .prepare(
        `UPDATE devices SET state = 'revoked', revoke_reason = 'replaced', revoked_at = ?4
         WHERE environment_id = ?2 AND client_id = ?3 AND state = 'active' AND id != ?1 AND ${live}`,
      )
      .bind(input.id, input.environmentId, input.clientId, input.now, input.generation),
    db
      .prepare(`UPDATE devices SET state = 'active' WHERE id = ?1 AND ${live}`)
      .bind(input.id, input.environmentId, input.clientId, input.now, input.generation),
    db
      .prepare("UPDATE environments SET policy = policy + 1 WHERE id = ?1 AND state = 'active'")
      .bind(input.environmentId),
  ]);

  return (results[1]?.meta.changes ?? 0) === 1;
}

/** Give up a reservation the desktop never confirmed. */
export async function releaseReservation(
  db: D1Database,
  input: { readonly id: string; readonly now: number },
): Promise<void> {
  await db
    .prepare(
      "UPDATE devices SET state = 'revoked', revoke_reason = 'unconfirmed', revoked_at = ?2 WHERE id = ?1 AND state = 'reserved'",
    )
    .bind(input.id, input.now)
    .run();
}

export async function findDevice(
  db: D1Database,
  input: { readonly environmentId: string; readonly deviceId: string },
): Promise<Device | undefined> {
  return one(
    DeviceRow,
    await db
      .prepare(
        "SELECT id, environment_id, client_id, session_id, state FROM devices WHERE id = ?1 AND environment_id = ?2",
      )
      .bind(input.deviceId, input.environmentId)
      .first(),
  );
}

/**
 * The strong revocation: end the device and deny the Clerk session that
 * enrolled it, so that session cannot enroll again. It applies whatever ended
 * the device before (a release, a replacement, a lapsed grant), upgrading the
 * reason to `revoked`, so a weaker end can never stand in for this one. An
 * existing denial is kept as it is. Idempotent.
 */
export async function revokeDevice(
  db: D1Database,
  input: {
    readonly environmentId: string;
    readonly deviceId: string;
    readonly ownerId: string;
    readonly now: number;
  },
): Promise<void> {
  const owned = `id = ?1 AND environment_id = ?2
    AND environment_id IN (SELECT id FROM environments WHERE owner_id = ?3)`;

  await db.batch([
    db
      .prepare(
        `INSERT INTO denied_sessions (session_id, user_id, denied_at, next_attempt_at)
         SELECT session_id, ?3, ?4, ?4 FROM devices WHERE ${owned}
         ON CONFLICT (session_id) DO NOTHING`,
      )
      .bind(input.deviceId, input.environmentId, input.ownerId, input.now),
    db
      .prepare(
        `UPDATE environments SET policy = policy + 1
         WHERE id = ?2 AND owner_id = ?3
           AND EXISTS (SELECT 1 FROM devices WHERE ${owned} AND state != 'revoked')`,
      )
      .bind(input.deviceId, input.environmentId, input.ownerId),
    db
      .prepare(
        `UPDATE devices
         SET state = 'revoked', revoke_reason = 'revoked', revoked_at = coalesce(revoked_at, ?4)
         WHERE ${owned} AND (state != 'revoked' OR revoke_reason != 'revoked')`,
      )
      .bind(input.deviceId, input.environmentId, input.ownerId, input.now),
  ]);
}

/**
 * End a device at its own phone's request, relayed by the desktop: revoked
 * like any other, active or still reserved, but its Clerk session is left
 * alone and an existing session denial stays. Idempotent.
 */
export async function markDeviceReleased(
  db: D1Database,
  input: { readonly environmentId: string; readonly deviceId: string; readonly now: number },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE environments SET policy = policy + 1
         WHERE id = ?2
           AND EXISTS (SELECT 1 FROM devices WHERE id = ?1 AND environment_id = ?2 AND state != 'revoked')`,
      )
      .bind(input.deviceId, input.environmentId),
    db
      .prepare(
        `UPDATE devices SET state = 'revoked', revoke_reason = 'released', revoked_at = ?3
         WHERE id = ?1 AND environment_id = ?2 AND state != 'revoked'`,
      )
      .bind(input.deviceId, input.environmentId, input.now),
  ]);
}

/** Revoke reservations whose grant lapsed before the desktop's receipt was committed. */
export async function expireReservations(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE environments SET policy = policy + 1
         WHERE id IN (SELECT environment_id FROM devices WHERE state = 'reserved' AND grant_expires_at < ?1)`,
      )
      .bind(now),
    db
      .prepare(
        "UPDATE devices SET state = 'revoked', revoke_reason = 'expired', revoked_at = ?1 WHERE state = 'reserved' AND grant_expires_at < ?1",
      )
      .bind(now),
  ]);
}
