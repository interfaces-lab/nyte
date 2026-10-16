/** Headless link transactions: open, approve or deny, cancel, and expire. */
import type { D1Database } from "../d1.ts";
import { LinkTransactionRow, changed, one } from "./rows.ts";
import type { LinkTransaction } from "./rows.ts";

const LINK_TRANSACTION_PENDING_LIMIT = 3;

export type OpenTransactionOutcome =
  | { readonly kind: "opened"; readonly transaction: LinkTransaction }
  | { readonly kind: "conflict" }
  | { readonly kind: "code_taken" }
  | { readonly kind: "limit" };

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
