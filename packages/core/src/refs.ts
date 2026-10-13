import { asId } from "@nyte-ai/schema";
import type {
  CallId,
  HeadName,
  PartId,
  PrincipalId,
  ReceiptId,
  RunId,
  SessionId,
  WorkspaceId,
} from "@nyte-ai/schema";

/** Returns `sessions/<id>`: the session record. */
export function sessionRef(id: SessionId): string {
  return `sessions/${id}`;
}

/** Returns the session a ref name lives under, or null for a ref outside every session. */
export function sessionOf(name: string): SessionId | null {
  const [root, id] = name.split("/");

  return root === "sessions" && id ? asId<"session">(id) : null;
}

/** Returns the session and head a head ref names, or null for any other ref. */
export function headOf(
  name: string,
): { readonly session: SessionId; readonly head: HeadName } | null {
  const [root, id, kind, head, ...rest] = name.split("/");

  return root === "sessions" && id && kind === "heads" && head && rest.length === 0
    ? { session: asId<"session">(id), head: asId<"head">(head) }
    : null;
}

/** Returns `sessions/<id>/heads/<name>`: the head's tip commit. */
export function headRef(id: SessionId, head: HeadName): string {
  return `sessions/${id}/heads/${head}`;
}

/** Returns `sessions/<id>/inbox/<name>`: the head's admitted inputs, in order. */
export function inboxRef(id: SessionId, head: HeadName): string {
  return `sessions/${id}/inbox/${head}`;
}

/** Returns `sessions/<id>/seen/<principal>/<head>`: the principal's seen mark on a head. */
export function seenRef(id: SessionId, principal: PrincipalId, head: HeadName): string {
  return `sessions/${id}/seen/${principal}/${head}`;
}

/** Returns `sessions/<id>/runs/<run>`: the run record, present while the run is live. */
export function runRef(id: SessionId, run: RunId): string {
  return `sessions/${id}/runs/${run}`;
}

/** Returns `sessions/<id>/parts/<part>`: the part's current state version. */
export function partRef(id: SessionId, part: PartId): string {
  return `sessions/${id}/parts/${part}`;
}

/** Returns `sessions/<id>/changes`: the files the session's runs changed, latest per path. */
export function changesRef(id: SessionId): string {
  return `sessions/${id}/changes`;
}

/** Returns `sessions/<id>/receipts/<receipt>`: the durable command's kind, digest and outcome. */
export function receiptRef(id: SessionId, receipt: ReceiptId): string {
  return `sessions/${id}/receipts/${receipt}`;
}

/** Returns `sessions/<id>/calls/<call>`: a durable step's intent, memos, acquisitions and wait. */
export function callRef(id: SessionId, call: CallId): string {
  return `sessions/${id}/calls/${call}`;
}

/** Returns `workspaces/<id>`: the workspace record. */
export function workspaceRef(id: WorkspaceId): string {
  return `workspaces/${id}`;
}

/** Returns `kv/<scope>/<owner>/<key>`: a setting, plugin storage value or encrypted secret. */
export function kvRef(scope: string, owner: string, key: string): string {
  return `kv/${scope}/${owner}/${key}`;
}

/** Returns `sessions/<id>/leases/<head>`: the execution lease on a head. */
export function leaseRef(id: SessionId, head: HeadName): string {
  return `sessions/${id}/leases/${head}`;
}

/** Returns `host/identity`: the host's id, written once and never moved. */
export function hostIdentityRef(): string {
  return "host/identity";
}

/** Returns `host/principals`: the paired principals. */
export function hostPrincipalsRef(): string {
  return "host/principals";
}
