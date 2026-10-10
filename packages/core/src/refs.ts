import type { CallId, HeadName, HostId, PartId, PrincipalId, ReceiptId, RunId, SessionId, WorkspaceId } from "@nyte-ai/schema";

/** Returns `sessions/<id>`: the session record. */
export function sessionRef(id: SessionId): string {
  return `sessions/${id}`;
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

/** Returns `sessions/<id>/receipts/<receipt>`: the durable command's kind, digest and outcome. */
export function receiptRef(id: SessionId, receipt: ReceiptId): string {
  return `sessions/${id}/receipts/${receipt}`;
}

/** Returns `sessions/<id>/calls/<call>`: a durable step's intent, memos, acquisitions and wait. */
export function callRef(id: SessionId, call: CallId): string {
  return `sessions/${id}/calls/${call}`;
}

/** Returns `sessions/<id>/journal/<principal>`: the client-side request journal. */
export function journalRef(id: SessionId, principal: PrincipalId): string {
  return `sessions/${id}/journal/${principal}`;
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

/** Returns `host/settings`: the host-scope settings. */
export function hostSettingsRef(): string {
  return "host/settings";
}

/** Returns `host/principals`: the paired principals. */
export function hostPrincipalsRef(): string {
  return "host/principals";
}

/** Returns `host/catalog`: the model catalog. */
export function hostCatalogRef(): string {
  return "host/catalog";
}

/** Returns what `host/identity` holds: the host's id and when it was first opened. */
export interface HostIdentity { readonly id: HostId; readonly createdAt: number }

/** Returns what `sessions/<id>/leases/<head>` holds: the host running the head and when its lease expires. */
export interface Lease { readonly holder: HostId; readonly expiresAt: number }
