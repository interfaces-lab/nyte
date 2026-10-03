/**
 * Every D1 statement the broker and the relay run. Rows are checked against their schema
 * on the way out. State changes that a lease reflects bump the environment's
 * `policy` in the same transaction; a revoked row never changes back.
 */
import { DEVICE_LIMIT } from "@nyte-ai/connect";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { D1Database, D1PreparedStatement } from "./d1.ts";

/** Environments an owner may hold at once. */
export const ENVIRONMENT_LIMIT = 3;

const Nullable = <S extends TSchema>(schema: S) => Type.Union([schema, Type.Null()]);

const EnvironmentRow = Type.Object({
  id: Type.String(),
  owner_id: Type.String(),
  thumbprint: Type.String(),
  public_key: Type.String(),
  name: Type.String(),
  state: Type.Union([Type.Literal("active"), Type.Literal("revoked")]),
  generation: Type.Integer(),
  policy: Type.Integer(),
  relay_session: Nullable(Type.String()),
  created_at: Type.Integer(),
  last_seen_at: Nullable(Type.Integer()),
  revoked_at: Nullable(Type.Integer()),
});

export type Environment = Static<typeof EnvironmentRow>;

const DeviceRow = Type.Object({
  id: Type.String(),
  environment_id: Type.String(),
  client_id: Type.String(),
  session_id: Type.String(),
  state: Type.Union([Type.Literal("reserved"), Type.Literal("active"), Type.Literal("revoked")]),
});

export type Device = Static<typeof DeviceRow>;

const OwnerRow = Type.Object({
  user_id: Type.String(),
  status: Type.Union([Type.Literal("active"), Type.Literal("disabled"), Type.Literal("deleted")]),
  version: Type.Integer(),
  checked_at: Nullable(Type.Integer()),
});

export type Owner = Static<typeof OwnerRow>;

const IdRow = Type.Object({ id: Type.String() });
const RelayDeviceRow = Type.Object({
  id: Type.String(),
  state: Type.Union([Type.Literal("reserved"), Type.Literal("active"), Type.Literal("revoked")]),
  environment_state: Type.Union([Type.Literal("active"), Type.Literal("revoked")]),
  owner_status: Type.Union([
    Type.Literal("active"),
    Type.Literal("disabled"),
    Type.Literal("deleted"),
  ]),
});

export type RelayDevice = Static<typeof RelayDeviceRow>;
const CountRow = Type.Object({ count: Type.Integer() });
const PendingSessionRow = Type.Object({ session_id: Type.String(), attempts: Type.Integer() });

export class UnexpectedRow extends Error {
  constructor() {
    super("A D1 row did not match its schema");
    this.name = "UnexpectedRow";
  }
}

function one<S extends TSchema>(schema: S, row: unknown): Static<S> | undefined {
  if (row === null || row === undefined) return undefined;

  if (!Value.Check(schema, row)) throw new UnexpectedRow();

  return row;
}

function many<S extends TSchema>(schema: S, rows: readonly unknown[]): Static<S>[] {
  return rows.map((row) => {
    if (!Value.Check(schema, row)) throw new UnexpectedRow();

    return row;
  });
}

async function changed(statement: D1PreparedStatement): Promise<boolean> {
  return (await statement.run()).meta.changes > 0;
}

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

export async function findEnvironment(
  db: D1Database,
  id: string,
): Promise<Environment | undefined> {
  return one(
    EnvironmentRow,
    await db.prepare("SELECT * FROM environments WHERE id = ?1").bind(id).first(),
  );
}

/** The environment if `ownerId` owns it. Another owner's environment is indistinguishable from none. */
export async function findOwnedEnvironment(
  db: D1Database,
  input: { readonly id: string; readonly ownerId: string },
): Promise<Environment | undefined> {
  return one(
    EnvironmentRow,
    await db
      .prepare("SELECT * FROM environments WHERE id = ?1 AND owner_id = ?2")
      .bind(input.id, input.ownerId)
      .first(),
  );
}

export async function findEnvironmentByThumbprint(
  db: D1Database,
  thumbprint: string,
): Promise<Environment | undefined> {
  return one(
    EnvironmentRow,
    await db.prepare("SELECT * FROM environments WHERE thumbprint = ?1").bind(thumbprint).first(),
  );
}

export async function listActiveEnvironments(
  db: D1Database,
  ownerId: string,
): Promise<Environment[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM environments WHERE owner_id = ?1 AND state = 'active' ORDER BY created_at, id LIMIT 64",
    )
    .bind(ownerId)
    .all();

  return many(EnvironmentRow, results);
}

export async function countLiveEnvironments(db: D1Database, ownerId: string): Promise<number> {
  const row = one(
    CountRow,
    await db
      .prepare(
        "SELECT count(*) AS count FROM environments WHERE owner_id = ?1 AND state = 'active'",
      )
      .bind(ownerId)
      .first(),
  );

  return row?.count ?? 0;
}

/**
 * Insert an active environment, unless the owner already has
 * `ENVIRONMENT_LIMIT` of them or the key is taken. One statement, so
 * concurrent links cannot overshoot the limit.
 */
export async function insertEnvironment(
  db: D1Database,
  input: {
    readonly id: string;
    readonly ownerId: string;
    readonly thumbprint: string;
    readonly publicKey: string;
    readonly name: string;
    readonly now: number;
  },
): Promise<boolean> {
  return changed(
    db
      .prepare(
        `INSERT INTO environments
           (id, owner_id, thumbprint, public_key, name, state, generation, policy, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, 'active', 1, 1, ?6
         WHERE (SELECT count(*) FROM environments WHERE owner_id = ?2 AND state = 'active') < ?7
         ON CONFLICT DO NOTHING`,
      )
      .bind(
        input.id,
        input.ownerId,
        input.thumbprint,
        input.publicKey,
        input.name,
        input.now,
        ENVIRONMENT_LIMIT,
      ),
  );
}

/** The name a resumed link gives its environment. */
export async function renameEnvironment(
  db: D1Database,
  input: { readonly id: string; readonly name: string },
): Promise<void> {
  await db
    .prepare("UPDATE environments SET name = ?2 WHERE id = ?1 AND state = 'active'")
    .bind(input.id, input.name)
    .run();
}

const REVOKE_ENVIRONMENTS = `UPDATE environments
  SET state = 'revoked', generation = generation + 1, policy = policy + 1, revoked_at = ?2,
      relay_session = NULL
  WHERE state != 'revoked' AND `;

const REVOKE_DEVICES = `UPDATE devices SET state = 'revoked', revoke_reason = 'environment', revoked_at = ?2
  WHERE state != 'revoked' AND environment_id IN `;

/** Revoke an environment and all its devices. Idempotent; a revoked row stays revoked. */
export async function revokeEnvironment(
  db: D1Database,
  input: { readonly id: string; readonly now: number },
): Promise<void> {
  await db.batch([
    db.prepare(`${REVOKE_DEVICES} (?1)`).bind(input.id, input.now),
    db.prepare(`${REVOKE_ENVIRONMENTS} id = ?1`).bind(input.id, input.now),
  ]);
}

export async function touchEnvironment(
  db: D1Database,
  input: { readonly id: string; readonly now: number },
): Promise<void> {
  await db
    .prepare("UPDATE environments SET last_seen_at = ?2 WHERE id = ?1 AND state = 'active'")
    .bind(input.id, input.now)
    .run();
}

/** The owner's active environment ids. */
export async function ownerEnvironmentIds(db: D1Database, ownerId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT id FROM environments WHERE owner_id = ?1 AND state = 'active' LIMIT 64")
    .bind(ownerId)
    .all();

  return many(IdRow, results).map((row) => row.id);
}

/**
 * Record the relay socket that proved the environment's key, replacing any
 * earlier one. False when the environment is no longer active.
 */
export async function attachRelay(
  db: D1Database,
  input: { readonly id: string; readonly session: string },
): Promise<boolean> {
  return changed(
    db
      .prepare("UPDATE environments SET relay_session = ?2 WHERE id = ?1 AND state = 'active'")
      .bind(input.id, input.session),
  );
}

/** Forget the relay socket, unless a newer one has replaced it. */
export async function detachRelay(
  db: D1Database,
  input: { readonly id: string; readonly session: string },
): Promise<void> {
  await db
    .prepare("UPDATE environments SET relay_session = NULL WHERE id = ?1 AND relay_session = ?2")
    .bind(input.id, input.session)
    .run();
}

/**
 * The device a relayed bearer digest names in this environment, with the
 * environment's state and its owner's standing. A live device wins over a
 * revoked one with the same digest.
 */
export async function findRelayDevice(
  db: D1Database,
  input: { readonly environmentId: string; readonly digest: string },
): Promise<RelayDevice | undefined> {
  return one(
    RelayDeviceRow,
    await db
      .prepare(
        `SELECT d.id, d.state, e.state AS environment_state, coalesce(o.status, 'active') AS owner_status
         FROM devices d
         JOIN environments e ON e.id = d.environment_id
         LEFT JOIN owners o ON o.user_id = e.owner_id
         WHERE d.environment_id = ?1 AND d.digest = ?2
         ORDER BY CASE d.state WHEN 'active' THEN 0 WHEN 'reserved' THEN 1 ELSE 2 END, d.created_at DESC
         LIMIT 1`,
      )
      .bind(input.environmentId, input.digest)
      .first(),
  );
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

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

/** One consistent read of what a lease states. */
export async function leaseSnapshot(
  db: D1Database,
  environmentId: string,
): Promise<{ readonly environment: Environment; readonly devices: string[] } | undefined> {
  const [environment, devices] = await db.batch([
    db.prepare("SELECT * FROM environments WHERE id = ?1").bind(environmentId),
    db
      .prepare(
        "SELECT id FROM devices WHERE environment_id = ?1 AND state = 'active' ORDER BY created_at, id LIMIT ?2",
      )
      .bind(environmentId, DEVICE_LIMIT),
  ]);
  const row = one(EnvironmentRow, environment?.results[0]);

  if (row === undefined) return undefined;

  return {
    environment: row,
    devices: many(IdRow, devices?.results ?? []).map((device) => device.id),
  };
}

// ---------------------------------------------------------------------------
// Owners and sessions
// ---------------------------------------------------------------------------

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

export async function isSessionDenied(
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
export const SESSION_REVOKE_ATTEMPTS = 30;

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

// ---------------------------------------------------------------------------
// Replays, rate limits, and housekeeping
// ---------------------------------------------------------------------------

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

/** Count a request in a fixed window. False once the window holds more than `limit`. */
export async function hit(
  db: D1Database,
  input: {
    readonly key: string;
    readonly windowMs: number;
    readonly limit: number;
    readonly now: number;
  },
): Promise<boolean> {
  const windowStart = input.now - (input.now % input.windowMs);
  const row = one(
    CountRow,
    await db
      .prepare(
        `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
           window_start = excluded.window_start
         RETURNING count`,
      )
      .bind(input.key, windowStart)
      .first(),
  );

  return row !== undefined && row.count <= input.limit;
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
