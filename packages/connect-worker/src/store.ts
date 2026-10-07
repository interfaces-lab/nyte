/**
 * Every D1 statement the broker and the relay run. Rows are checked against their schema
 * on the way out. State changes that a lease reflects bump the environment's
 * `policy` in the same transaction; a revoked row never changes back.
 */
import { DEVICE_LIMIT } from "@nyte-ai/connect";
import type { LinkTransactionState } from "@nyte-ai/connect";
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

const LinkTransactionRow = Type.Object({
  id: Type.String(),
  thumbprint: Type.String(),
  public_key: Type.String(),
  operation_id: Type.String(),
  name: Type.String(),
  code_hash: Type.String(),
  state: Type.Union([
    Type.Literal("pending"),
    Type.Literal("approved"),
    Type.Literal("denied"),
    Type.Literal("expired"),
    Type.Literal("cancelled"),
    Type.Literal("consumed"),
  ]),
  created_at: Type.Integer(),
  expires_at: Type.Integer(),
  owner_id: Nullable(Type.String()),
  session_id: Nullable(Type.String()),
  owner_label: Nullable(Type.String()),
  approved_at: Nullable(Type.Integer()),
  authorization_expires_at: Nullable(Type.Integer()),
  environment_id: Nullable(Type.String()),
  consumed_at: Nullable(Type.Integer()),
});

export type LinkTransaction = Static<typeof LinkTransactionRow>;

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
 * Who may claim an environment, as one SQL predicate used by every statement
 * of a claim: an owner the broker has not heard is disabled or deleted, and a
 * session the broker has not denied. `owner` and `session` are bound
 * parameters or columns qualified with their outer table, never bare names,
 * since the subqueries have columns of those names themselves.
 */
const standing = (owner: string, session: string, now: string) => `
  NOT EXISTS (SELECT 1 FROM owners WHERE user_id = ${owner} AND status != 'active')
  AND NOT EXISTS (SELECT 1 FROM denied_sessions
                  WHERE session_id = ${session} AND (expires_at IS NULL OR expires_at > ${now}))`;

const CLAIM_INSERT = `INSERT INTO environments
  (id, owner_id, thumbprint, public_key, name, state, generation, policy, created_at)`;

/**
 * What a claim asks for. A `session` claim is the signed-in browser's own
 * link; a `transaction` claim derives owner, session, key and name from the
 * approved transaction it names, never from the host.
 */
export type ClaimInput =
  | {
      readonly kind: "session";
      readonly ownerId: string;
      readonly sessionId: string;
      readonly thumbprint: string;
      readonly publicKey: string;
      readonly name: string;
      readonly now: number;
    }
  | {
      readonly kind: "transaction";
      readonly transactionId: string;
      readonly thumbprint: string;
      readonly now: number;
    };

export type ClaimOutcome =
  | { readonly kind: "linked"; readonly environment: Environment; readonly fresh: boolean }
  /** The key belongs to another owner's environment. */
  | { readonly kind: "conflict" }
  /** The key's environment was unlinked; the key is never reused. */
  | { readonly kind: "revoked" }
  | { readonly kind: "limit" }
  | { readonly kind: "owner_disabled" }
  | { readonly kind: "session_revoked" }
  /** A transaction claim: the transaction is not approved. */
  | { readonly kind: "transaction"; readonly state: Exclude<LinkTransactionState, "consumed"> }
  /** A transaction claim whose transaction was consumed earlier by this same key: the receipt comes back. */
  | {
      readonly kind: "recovered";
      readonly environment: Environment;
      readonly transaction: LinkTransaction;
    };

/**
 * The one way an environment is created or resumed. One batch: insert a new
 * active environment within the owner's limit, or rename the owner's active
 * one for this key; for a transaction, consume it only when that exact
 * active environment exists; then read what stands. Every statement carries
 * the same eligibility, so a revoked owner, denied session, lapsed approval
 * or cancelled transaction changes nothing. The answer is read after the
 * batch, never before it.
 */
export async function claimEnvironment(db: D1Database, input: ClaimInput): Promise<ClaimOutcome> {
  const id = crypto.randomUUID();

  if (input.kind === "session") {
    const eligible = standing("?2", "?8", "?7");
    const [inserted, renamed, row] = await db.batch([
      db
        .prepare(
          `${CLAIM_INSERT}
           SELECT ?1, ?2, ?3, ?4, ?5, 'active', 1, 1, ?7
           WHERE ${eligible}
             AND NOT EXISTS (SELECT 1 FROM environments WHERE thumbprint = ?3)
             AND (SELECT count(*) FROM environments WHERE owner_id = ?2 AND state = 'active') < ?6`,
        )
        .bind(
          id,
          input.ownerId,
          input.thumbprint,
          input.publicKey,
          input.name,
          ENVIRONMENT_LIMIT,
          input.now,
          input.sessionId,
        ),
      db
        .prepare(
          `UPDATE environments SET name = ?5
           WHERE thumbprint = ?3 AND owner_id = ?2 AND state = 'active'
             AND ${standing("?2", "?4", "?1")}`,
        )
        .bind(input.now, input.ownerId, input.thumbprint, input.sessionId, input.name),
      db.prepare("SELECT * FROM environments WHERE thumbprint = ?1").bind(input.thumbprint),
    ]);
    const environment = one(EnvironmentRow, row?.results[0]);
    const wrote = (inserted?.meta.changes ?? 0) + (renamed?.meta.changes ?? 0) > 0;

    if (environment !== undefined) {
      if (environment.state === "revoked") return { kind: "revoked" };

      if (environment.owner_id !== input.ownerId) return { kind: "conflict" };

      // The owner's active key, yet neither statement touched it: eligibility refused the write.
      if (!wrote)
        return refusedClaim(db, {
          ownerId: input.ownerId,
          sessionId: input.sessionId,
          now: input.now,
        });

      return { kind: "linked", environment, fresh: environment.id === id };
    }

    return refusedClaim(db, { ownerId: input.ownerId, sessionId: input.sessionId, now: input.now });
  }

  // A transaction's owner, session, key and name are its own columns: `t` throughout.
  const approved = `t.id = ?1 AND t.thumbprint = ?2 AND t.state = 'approved'
    AND t.authorization_expires_at > ?3 AND ${standing("t.owner_id", "t.session_id", "?3")}`;
  const [, , consumed, environmentRow, transactionRow] = await db.batch([
    db
      .prepare(
        `${CLAIM_INSERT}
         SELECT ?4, t.owner_id, t.thumbprint, t.public_key, t.name, 'active', 1, 1, ?3
         FROM link_transactions t
         WHERE ${approved}
           AND NOT EXISTS (SELECT 1 FROM environments WHERE thumbprint = t.thumbprint)
           AND (SELECT count(*) FROM environments WHERE owner_id = t.owner_id AND state = 'active') < ?5`,
      )
      .bind(input.transactionId, input.thumbprint, input.now, id, ENVIRONMENT_LIMIT),
    db
      .prepare(
        `UPDATE environments SET name = (SELECT t.name FROM link_transactions t WHERE ${approved})
         WHERE thumbprint = ?2 AND state = 'active'
           AND owner_id = (SELECT t.owner_id FROM link_transactions t WHERE ${approved})`,
      )
      .bind(input.transactionId, input.thumbprint, input.now),
    db
      .prepare(
        `UPDATE link_transactions SET state = 'consumed', consumed_at = ?3,
           environment_id = (SELECT e.id FROM environments e
                             WHERE e.thumbprint = ?2 AND e.state = 'active' AND e.owner_id = link_transactions.owner_id)
         WHERE id = ?1 AND thumbprint = ?2 AND state = 'approved' AND authorization_expires_at > ?3
           AND ${standing("link_transactions.owner_id", "link_transactions.session_id", "?3")}
           AND EXISTS (SELECT 1 FROM environments e
                       WHERE e.thumbprint = ?2 AND e.state = 'active' AND e.owner_id = link_transactions.owner_id)`,
      )
      .bind(input.transactionId, input.thumbprint, input.now),
    db.prepare("SELECT * FROM environments WHERE thumbprint = ?1").bind(input.thumbprint),
    db
      .prepare("SELECT * FROM link_transactions WHERE id = ?1 AND thumbprint = ?2")
      .bind(input.transactionId, input.thumbprint),
  ]);
  const environment = one(EnvironmentRow, environmentRow?.results[0]);
  const transaction = one(LinkTransactionRow, transactionRow?.results[0]);

  if (transaction === undefined) return { kind: "transaction", state: "cancelled" };

  if (transaction.state === "consumed") {
    if (
      environment === undefined ||
      environment.id !== transaction.environment_id ||
      environment.state === "revoked"
    )
      return { kind: "revoked" };

    return (consumed?.meta.changes ?? 0) === 1
      ? { kind: "linked", environment, fresh: environment.id === id }
      : { kind: "recovered", environment, transaction };
  }

  if (transaction.state !== "approved" || transaction.authorization_expires_at === null)
    return { kind: "transaction", state: transaction.state };

  if (transaction.authorization_expires_at <= input.now)
    return { kind: "transaction", state: "expired" };

  if (environment?.state === "revoked") return { kind: "revoked" };

  if (environment !== undefined && environment.owner_id !== transaction.owner_id)
    return { kind: "conflict" };

  return refusedClaim(db, {
    ownerId: transaction.owner_id ?? "",
    sessionId: transaction.session_id ?? "",
    now: input.now,
  });
}

/** Why a claim that changed nothing was refused: standing first, then the limit. */
async function refusedClaim(
  db: D1Database,
  input: { readonly ownerId: string; readonly sessionId: string; readonly now: number },
): Promise<ClaimOutcome> {
  const owner = await findOwner(db, input.ownerId);

  if (owner !== undefined && owner.status !== "active") return { kind: "owner_disabled" };

  if (await isSessionDenied(db, { sessionId: input.sessionId, now: input.now }))
    return { kind: "session_revoked" };

  return { kind: "limit" };
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
// Link transactions
// ---------------------------------------------------------------------------

/** Pending transactions one key may hold; a retried open resumes rather than adds. */
export const LINK_TRANSACTION_PENDING_LIMIT = 3;

export type OpenTransactionOutcome =
  | { readonly kind: "opened"; readonly transaction: LinkTransaction }
  /** The same key and operation id with a different name or key material. */
  | { readonly kind: "conflict" }
  /** Another pending transaction already holds this code. */
  | { readonly kind: "code_taken" }
  | { readonly kind: "limit" };

/**
 * Open a transaction, or find the one this key already opened under the same
 * operation id. Insert-or-read, so a retried open after a lost answer gets
 * the same row; its immutable name, key and code are compared.
 */
export async function openLinkTransaction(
  db: D1Database,
  input: {
    readonly id: string;
    readonly thumbprint: string;
    readonly publicKey: string;
    readonly operationId: string;
    readonly name: string;
    readonly codeHash: string;
    readonly now: number;
    readonly expiresAt: number;
  },
): Promise<OpenTransactionOutcome> {
  const existing = await findLinkTransactionByOperation(db, {
    thumbprint: input.thumbprint,
    operationId: input.operationId,
  });

  if (existing === undefined) {
    let inserted: boolean;

    try {
      inserted = await changed(
        db
          .prepare(
            `INSERT INTO link_transactions
               (id, thumbprint, public_key, operation_id, name, code_hash, state, created_at, expires_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8
             WHERE (SELECT count(*) FROM link_transactions WHERE thumbprint = ?2 AND state = 'pending') < ?9
             ON CONFLICT (thumbprint, operation_id) DO NOTHING`,
          )
          .bind(
            input.id,
            input.thumbprint,
            input.publicKey,
            input.operationId,
            input.name,
            input.codeHash,
            input.now,
            input.expiresAt,
            LINK_TRANSACTION_PENDING_LIMIT,
          ),
      );
    } catch {
      // The partial unique index on pending codes is the only other constraint that can fail.
      return { kind: "code_taken" };
    }

    const row = await findLinkTransactionByOperation(db, {
      thumbprint: input.thumbprint,
      operationId: input.operationId,
    });

    if (row === undefined) return { kind: "limit" };

    if (inserted) return { kind: "opened", transaction: row };

    return sameOpen(row, input);
  }

  return sameOpen(existing, input);
}

function sameOpen(
  row: LinkTransaction,
  input: { readonly publicKey: string; readonly name: string; readonly codeHash: string },
): OpenTransactionOutcome {
  return row.public_key === input.publicKey &&
    row.name === input.name &&
    row.code_hash === input.codeHash
    ? { kind: "opened", transaction: row }
    : { kind: "conflict" };
}

async function findLinkTransactionByOperation(
  db: D1Database,
  input: { readonly thumbprint: string; readonly operationId: string },
): Promise<LinkTransaction | undefined> {
  return one(
    LinkTransactionRow,
    await db
      .prepare("SELECT * FROM link_transactions WHERE thumbprint = ?1 AND operation_id = ?2")
      .bind(input.thumbprint, input.operationId)
      .first(),
  );
}

export async function findLinkTransaction(
  db: D1Database,
  id: string,
): Promise<LinkTransaction | undefined> {
  return one(
    LinkTransactionRow,
    await db.prepare("SELECT * FROM link_transactions WHERE id = ?1").bind(id).first(),
  );
}

/** The pending, unexpired transaction a code names. Expired ones are invisible before the sweep marks them. */
export async function findPendingLinkTransaction(
  db: D1Database,
  input: { readonly codeHash: string; readonly now: number },
): Promise<LinkTransaction | undefined> {
  return one(
    LinkTransactionRow,
    await db
      .prepare(
        "SELECT * FROM link_transactions WHERE code_hash = ?1 AND state = 'pending' AND expires_at > ?2",
      )
      .bind(input.codeHash, input.now)
      .first(),
  );
}

/** Bind the owner to a pending, unexpired transaction, once. False when it is no longer pending. */
export async function approveLinkTransaction(
  db: D1Database,
  input: {
    readonly id: string;
    readonly ownerId: string;
    readonly sessionId: string;
    readonly ownerLabel: string;
    readonly now: number;
    readonly authorizationExpiresAt: number;
  },
): Promise<boolean> {
  return changed(
    db
      .prepare(
        `UPDATE link_transactions
         SET state = 'approved', owner_id = ?2, session_id = ?3, owner_label = ?4,
             approved_at = ?5, authorization_expires_at = ?6
         WHERE id = ?1 AND state = 'pending' AND expires_at > ?5`,
      )
      .bind(
        input.id,
        input.ownerId,
        input.sessionId,
        input.ownerLabel,
        input.now,
        input.authorizationExpiresAt,
      ),
  );
}

/** The owner refuses a pending transaction. False when it is no longer pending. */
export async function denyLinkTransaction(
  db: D1Database,
  input: { readonly id: string; readonly now: number },
): Promise<boolean> {
  return changed(
    db
      .prepare(
        "UPDATE link_transactions SET state = 'denied' WHERE id = ?1 AND state = 'pending' AND expires_at > ?2",
      )
      .bind(input.id, input.now),
  );
}

const UNBIND = `owner_id = NULL, session_id = NULL, owner_label = NULL,
  approved_at = NULL, authorization_expires_at = NULL`;

/**
 * The host gives up: an unfinished transaction ends cancelled with its
 * binding dropped. A consumed one is left as it is; the row read back says
 * which happened.
 */
export async function cancelLinkTransaction(
  db: D1Database,
  input: { readonly id: string; readonly thumbprint: string },
): Promise<LinkTransaction | undefined> {
  const [, row] = await db.batch([
    db
      .prepare(
        `UPDATE link_transactions SET state = 'cancelled', ${UNBIND}
         WHERE id = ?1 AND thumbprint = ?2 AND state IN ('pending', 'approved')`,
      )
      .bind(input.id, input.thumbprint),
    db
      .prepare("SELECT * FROM link_transactions WHERE id = ?1 AND thumbprint = ?2")
      .bind(input.id, input.thumbprint),
  ]);

  return one(LinkTransactionRow, row?.results[0]);
}

/**
 * Lapse what the owner never approved and what the host never completed.
 * Terminal rows are kept: a consumed row is the only way a key that lost the
 * answer finds its environment again, and a cancelled or lapsed row is what
 * keeps the same signed open from reopening under a new id. Nothing in a
 * terminal row is a secret: the code hash only ever matched while pending,
 * and the binding is dropped with the state.
 */
export async function expireLinkTransactions(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db
      .prepare(
        "UPDATE link_transactions SET state = 'expired' WHERE state = 'pending' AND expires_at <= ?1",
      )
      .bind(now),
    db
      .prepare(
        `UPDATE link_transactions SET state = 'expired', ${UNBIND}
         WHERE state = 'approved' AND authorization_expires_at <= ?1`,
      )
      .bind(now),
  ]);
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
