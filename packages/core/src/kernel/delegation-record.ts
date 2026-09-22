import { toJsonValue } from "@nyte-ai/client";
import type { DelegateRequest, RunId, SessionId } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { DELEGATION_PREFIX, delegationPrefix } from "./names.ts";
import type { Oid, RefName, RefUpdate } from "./model.ts";
import type { PendingChange } from "./queue.ts";
import type { Session } from "./store.ts";

const delegateRequest = Type.Union([
  Type.Object({ kind: Type.Literal("commit"), oid: Type.String() }),
  Type.Object({ kind: Type.Literal("change"), oid: Type.String() }),
]);

export const delegationRecordSchema = Type.Object({
  runId: Type.String(),
  callId: Type.String(),
  head: Type.String(),
  at: Type.Number(),
  continuation: Type.Union([
    Type.Object({ kind: Type.Literal("authorized"), root: Type.String() }),
    Type.Object({ kind: Type.Literal("input") }),
    Type.Object({ kind: Type.Literal("consumed") }),
  ]),
  delivery: Type.Union([
    Type.Object({ kind: Type.Literal("owed") }),
    Type.Object({ kind: Type.Literal("delivered"), change: Type.String() }),
  ]),
  answer: Type.Union([
    Type.Object({ kind: Type.Literal("pending") }),
    Type.Object({
      kind: Type.Literal("ready"),
      request: delegateRequest,
      source: Type.Union([
        Type.Object({ kind: Type.Literal("run"), oid: Type.String() }),
        Type.Object({ kind: Type.Literal("cancelled") }),
      ]),
    }),
  ]),
});

export interface DelegationRecord {
  readonly runId: string;
  readonly callId: string;
  readonly head: string;
  readonly at: number;
  readonly continuation:
    | { readonly kind: "authorized"; readonly root: RunId }
    | { readonly kind: "input" }
    | { readonly kind: "consumed" };
  readonly delivery:
    | { readonly kind: "owed" }
    | { readonly kind: "delivered"; readonly change: Oid };
  readonly answer:
    | { readonly kind: "pending" }
    | {
        readonly kind: "ready";
        readonly request: DelegateRequest;
        readonly source:
          | { readonly kind: "run"; readonly oid: Oid }
          | { readonly kind: "cancelled" };
      };
}

export interface StoredDelegation {
  readonly ref: RefName;
  readonly oid: Oid;
  readonly change: Oid;
  readonly record: DelegationRecord;
}

export async function readDelegation(
  session: Session,
  entry: { readonly name: RefName; readonly oid: Oid },
  prefix: string,
): Promise<StoredDelegation> {
  const blob = await session.objects.get(entry.oid);

  if (blob?.kind !== "blob" || !Value.Check(delegationRecordSchema, blob.value)) {
    throw new Error(`Corrupt delegation record ${entry.name}`);
  }

  return {
    ref: entry.name,
    oid: entry.oid,
    change: entry.name.slice(prefix.length),
    record: blob.value,
  };
}

export async function putDelegationRecord(
  session: Session,
  record: DelegationRecord,
): Promise<Oid> {
  const oid = (await session.objects.put([{ kind: "blob", value: toJsonValue(record) }]))[0];

  if (oid === undefined) throw new Error("Delegation record write returned no object");

  return oid;
}

function sameRequest(left: DelegateRequest, right: DelegateRequest): boolean {
  return left.kind === right.kind && left.oid === right.oid;
}

export interface AuthorizedContinuation {
  readonly session: SessionId;
  readonly request: DelegateRequest;
  readonly root: RunId;
  readonly consume: RefUpdate;
}

export async function authorizedContinuation(
  session: Session,
  item: PendingChange,
): Promise<AuthorizedContinuation | undefined> {
  if (item.change.kind !== "answer") return undefined;
  const body = item.change.body;

  if (body.kind !== "completion" || body.job.kind !== "delegate") {
    throw new Error(`Answer change ${item.oid} has no delegate completion`);
  }

  const prefix = delegationPrefix(body.job.session);

  for (const entry of await session.refs.list(prefix)) {
    const stored = await readDelegation(session, entry, prefix);

    if (
      stored.record.continuation.kind !== "authorized" ||
      stored.record.answer.kind !== "ready" ||
      !sameRequest(stored.record.answer.request, body.job.request)
    ) {
      continue;
    }

    const consumed: DelegationRecord = {
      ...stored.record,
      continuation: { kind: "consumed" },
    };

    const oid = await putDelegationRecord(session, consumed);

    return {
      session: body.job.session,
      request: body.job.request,
      root: stored.record.continuation.root,
      consume: { name: stored.ref, from: stored.oid, to: oid },
    };
  }

  return undefined;
}

export async function revokeDelegations(
  session: Session,
  runId: string,
): Promise<readonly RefUpdate[]> {
  const updates: RefUpdate[] = [];

  for (const entry of await session.refs.list(DELEGATION_PREFIX)) {
    const slash = entry.name.lastIndexOf("/");
    const prefix = slash === -1 ? DELEGATION_PREFIX : entry.name.slice(0, slash + 1);
    const stored = await readDelegation(session, entry, prefix);

    if (stored.record.runId !== runId || stored.record.continuation.kind !== "authorized") continue;

    const revoked: DelegationRecord = {
      ...stored.record,
      continuation: { kind: "input" },
    };

    updates.push({
      name: stored.ref,
      from: stored.oid,
      to: await putDelegationRecord(session, revoked),
    });
  }

  return updates;
}
