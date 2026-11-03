/**
 * The D1 row schemas every table module reads through, the helpers that check
 * rows on the way out, and the statements more than one table module runs.
 */
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { D1PreparedStatement, D1Row } from "../d1.ts";

const Nullable = <S extends TSchema>(schema: S) => Type.Union([schema, Type.Null()]);

export const EnvironmentRow = Type.Object({
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

export const DeviceRow = Type.Object({
  id: Type.String(),
  environment_id: Type.String(),
  client_id: Type.String(),
  session_id: Type.String(),
  state: Type.Union([Type.Literal("reserved"), Type.Literal("active"), Type.Literal("revoked")]),
});

export type Device = Static<typeof DeviceRow>;

export const OwnerRow = Type.Object({
  user_id: Type.String(),
  status: Type.Union([Type.Literal("active"), Type.Literal("disabled"), Type.Literal("deleted")]),
  version: Type.Integer(),
  checked_at: Nullable(Type.Integer()),
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

export const RelayDeviceRow = Type.Object({
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

export const CountRow = Type.Object({ count: Type.Integer() });

export const PendingSessionRow = Type.Object({
  session_id: Type.String(),
  attempts: Type.Integer(),
});

class UnexpectedRow extends Error {
  constructor() {
    super("A D1 row did not match its schema");
    this.name = "UnexpectedRow";
  }
}

export function one<S extends TSchema>(
  schema: S,
  row: D1Row | null | undefined,
): Static<S> | undefined {
  if (row === null || row === undefined) return undefined;

  if (!Value.Check(schema, row)) throw new UnexpectedRow();

  return row;
}

export function many<S extends TSchema>(schema: S, rows: readonly D1Row[]): Static<S>[] {
  return rows.map((row) => {
    if (!Value.Check(schema, row)) throw new UnexpectedRow();

    return row;
  });
}

export async function changed(statement: D1PreparedStatement): Promise<boolean> {
  return (await statement.run()).meta.changes > 0;
}

/** Revoke matching environments, bumping generation and policy. Append the row filter. */
export const REVOKE_ENVIRONMENTS = `UPDATE environments
  SET state = 'revoked', generation = generation + 1, policy = policy + 1, revoked_at = ?2,
      relay_session = NULL
  WHERE state != 'revoked' AND `;

/** Revoke the devices of the environments listed after it. */
export const REVOKE_DEVICES = `UPDATE devices SET state = 'revoked', revoke_reason = 'environment', revoked_at = ?2
  WHERE state != 'revoked' AND environment_id IN `;
