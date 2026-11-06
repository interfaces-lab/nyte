import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { D1PreparedStatement } from "../d1.ts";

const Nullable = <S extends TSchema>(schema: S) => Type.Union([schema, Type.Null()]);

export const OwnerStatus = Type.Union([
  Type.Literal("active"),
  Type.Literal("disabled"),
  Type.Literal("deleted"),
]);

export type OwnerStatus = Static<typeof OwnerStatus>;

export const EnvironmentRow = Type.Object({
  id: Type.String(),
  owner_id: Type.String(),
  thumbprint: Type.String(),
  public_key: Type.String(),
  name: Type.String(),
  state: Type.Union([Type.Literal("active"), Type.Literal("revoked")]),
  created_at: Type.Integer(),
  revoked_at: Nullable(Type.Integer()),
});

export type Environment = Static<typeof EnvironmentRow>;

export const ENVIRONMENT_COLUMNS =
  "id, owner_id, thumbprint, public_key, name, state, created_at, revoked_at";

export const OwnerRow = Type.Object({
  user_id: Type.String(),
  status: OwnerStatus,
  version: Type.Integer(),
});

export type Owner = Static<typeof OwnerRow>;

export const LinkTransactionRow = Type.Object({
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

export const IdRow = Type.Object({ id: Type.String() });

export const CountRow = Type.Object({ count: Type.Integer() });

export const PendingSessionRow = Type.Object({
  session_id: Type.String(),
  attempts: Type.Integer(),
});

class UnexpectedRow extends Error {
  constructor() {
    super("A stored row did not match its schema");
    this.name = "UnexpectedRow";
  }
}

export function one<S extends TSchema>(schema: S, row: unknown): Static<S> | undefined {
  if (row === null || row === undefined) return undefined;

  if (!Value.Check(schema, row)) throw new UnexpectedRow();

  return row;
}

export function many<S extends TSchema>(schema: S, rows: readonly unknown[]): Static<S>[] {
  return rows.map((row) => {
    if (!Value.Check(schema, row)) throw new UnexpectedRow();

    return row;
  });
}

export async function changed(statement: D1PreparedStatement): Promise<boolean> {
  return (await statement.run()).meta.changes > 0;
}

export const RETIRE_ENVIRONMENTS = `UPDATE environments SET state = 'revoked', revoked_at = ?2
  WHERE state != 'revoked' AND `;
