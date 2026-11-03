/**
 * The D1 index of environments: claims, the owner's list, and retirement. A
 * retired row never changes back. Each environment's devices, policy, and
 * presence live in its relay Durable Object (`environment-record.ts`).
 */
import type { LinkTransactionState } from "@nyte-ai/connect";
import type { D1Database } from "../d1.ts";
import { findOwner, sessionDenied } from "./owners.ts";
import {
  ENVIRONMENT_COLUMNS,
  EnvironmentRow,
  IdRow,
  LinkTransactionRow,
  OwnerRow,
  RETIRE_ENVIRONMENTS,
  many,
  one,
} from "./rows.ts";
import type { Environment, LinkTransaction, Owner } from "./rows.ts";

/** Environments an owner may hold at once. */
const ENVIRONMENT_LIMIT = 3;

export async function listActiveEnvironments(
  db: D1Database,
  ownerId: string,
): Promise<Environment[]> {
  const { results } = await db
    .prepare(
      `SELECT ${ENVIRONMENT_COLUMNS} FROM environments WHERE owner_id = ?1 AND state = 'active' ORDER BY created_at, id LIMIT 64`,
    )
    .bind(ownerId)
    .all();

  return many(EnvironmentRow, results);
}

const standing = (owner: string, session: string, now: string) => `
  NOT EXISTS (SELECT 1 FROM owners WHERE user_id = ${owner} AND status != 'active')
  AND NOT EXISTS (SELECT 1 FROM denied_sessions
                  WHERE session_id = ${session} AND (expires_at IS NULL OR expires_at > ${now}))`;

const CLAIM_INSERT = `INSERT INTO environments
  (id, owner_id, thumbprint, public_key, name, state, created_at)`;

type ClaimInput =
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
  | { readonly kind: "conflict" }
  | { readonly kind: "revoked" }
  | { readonly kind: "limit" }
  | { readonly kind: "owner_disabled" }
  | { readonly kind: "session_revoked" }
  | { readonly kind: "transaction"; readonly state: Exclude<LinkTransactionState, "consumed"> }
  | {
      readonly kind: "recovered";
      readonly environment: Environment;
      readonly transaction: LinkTransaction;
    };

export async function claimEnvironment(db: D1Database, input: ClaimInput): Promise<ClaimOutcome> {
  const id = crypto.randomUUID();

  if (input.kind === "session") {
    const eligible = standing("?2", "?8", "?7");

    const [inserted, renamed, row] = await db.batch([
      db
        .prepare(
          `${CLAIM_INSERT}
           SELECT ?1, ?2, ?3, ?4, ?5, 'active', ?7
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
      db
        .prepare(`SELECT ${ENVIRONMENT_COLUMNS} FROM environments WHERE thumbprint = ?1`)
        .bind(input.thumbprint),
    ]);

    const environment = one(EnvironmentRow, row?.results[0]);
    const wrote = (inserted?.meta.changes ?? 0) + (renamed?.meta.changes ?? 0) > 0;

    if (environment !== undefined) {
      if (environment.state === "revoked") return { kind: "revoked" };

      if (environment.owner_id !== input.ownerId) return { kind: "conflict" };

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

  const approved = `t.id = ?1 AND t.thumbprint = ?2 AND t.state = 'approved'
    AND t.authorization_expires_at > ?3 AND ${standing("t.owner_id", "t.session_id", "?3")}`;

  const [, , consumed, environmentRow, transactionRow] = await db.batch([
    db
      .prepare(
        `${CLAIM_INSERT}
         SELECT ?4, t.owner_id, t.thumbprint, t.public_key, t.name, 'active', ?3
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
    db
      .prepare(`SELECT ${ENVIRONMENT_COLUMNS} FROM environments WHERE thumbprint = ?1`)
      .bind(input.thumbprint),
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

async function refusedClaim(
  db: D1Database,
  input: { readonly ownerId: string; readonly sessionId: string; readonly now: number },
): Promise<ClaimOutcome> {
  const owner = await findOwner(db, input.ownerId);

  if (owner !== undefined && owner.status !== "active") return { kind: "owner_disabled" };

  if (await sessionDenied(db, { sessionId: input.sessionId, now: input.now }))
    return { kind: "session_revoked" };

  return { kind: "limit" };
}

/** Retire an environment's index row: its slot frees and its key stays a tombstone. Idempotent. */
export async function retireEnvironment(
  db: D1Database,
  input: { readonly id: string; readonly at: number },
): Promise<void> {
  await db.prepare(`${RETIRE_ENVIRONMENTS} id = ?1`).bind(input.id, input.at).run();
}

/** The owner's environment ids: the active ones, or every one the owner ever linked. */
export async function ownerEnvironmentIds(
  db: D1Database,
  input: { readonly ownerId: string; readonly state: "active" | "any" },
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT id FROM environments WHERE owner_id = ?1 ${input.state === "active" ? "AND state = 'active'" : ""} LIMIT 64`,
    )
    .bind(input.ownerId)
    .all();

  return many(IdRow, results).map((row) => row.id);
}

/**
 * What an environment's relay copies once, the first time a desktop or its
 * owner reaches it: the identity, which never changes, and its owner's
 * current standing.
 */
export async function loadEnvironment(
  db: D1Database,
  id: string,
): Promise<{ readonly environment: Environment; readonly owner: Owner | undefined } | undefined> {
  const [environment, owner] = await db.batch([
    db.prepare(`SELECT ${ENVIRONMENT_COLUMNS} FROM environments WHERE id = ?1`).bind(id),
    db
      .prepare(
        "SELECT o.user_id, o.status, o.version FROM owners o JOIN environments e ON e.owner_id = o.user_id WHERE e.id = ?1",
      )
      .bind(id),
  ]);

  const row = one(EnvironmentRow, environment?.results[0]);

  return row === undefined
    ? undefined
    : { environment: row, owner: one(OwnerRow, owner?.results[0]) };
}
