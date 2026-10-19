import { asId } from "@nyte-ai/schema";
import type {
  CallId,
  HeadName,
  JobId,
  PartId,
  PrincipalId,
  ReceiptId,
  RunId,
  SessionId,
  WorkspaceId,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import { objectId } from "../util/content.ts";

export function sessionRef(id: SessionId): string {
  return `sessions/${id}`;
}

export function parseSessionRef(name: string): SessionId | null {
  const [root, id] = name.split("/");

  return root === "sessions" && id ? asId<"session">(id) : null;
}

export function parseHeadRef(
  name: string,
): { readonly session: SessionId; readonly head: HeadName } | null {
  const [root, id, kind, head, ...rest] = name.split("/");

  return root === "sessions" && id && kind === "heads" && head && rest.length === 0
    ? { session: asId<"session">(id), head: asId<"head">(head) }
    : null;
}

export function headRef(id: SessionId, head: HeadName): string {
  return `sessions/${id}/heads/${head}`;
}

export function inboxRef(id: SessionId, head: HeadName): string {
  return `sessions/${id}/inbox/${head}`;
}

export function seenRef(id: SessionId, principal: PrincipalId, head: HeadName): string {
  return `sessions/${id}/seen/${principal}/${head}`;
}

export function runRef(id: SessionId, run: RunId): string {
  return `sessions/${id}/runs/${run}`;
}

export function endedRunRef(id: SessionId, run: RunId): string {
  return `sessions/${id}/ended/${run}`;
}

export function liveRef(id: SessionId, run: RunId): string {
  return `sessions/${id}/live/${run}`;
}

export function runCallsPrefix(id: SessionId, run: RunId): string {
  return `sessions/${id}/calls/${run}:`;
}

export function partRef(id: SessionId, part: PartId): string {
  return `sessions/${id}/parts/${part}`;
}

export function receiptRef(id: SessionId, receipt: ReceiptId): string {
  return `sessions/${id}/receipts/${receipt}`;
}

export function callRef(id: SessionId, call: CallId): string {
  return `sessions/${id}/calls/${call}`;
}

export function workspaceRef(id: WorkspaceId): string {
  return `workspaces/${id}`;
}

export async function trustRef(target: WorkspaceTarget): Promise<string> {
  return `trust/${await objectId(trustTarget(target))}`;
}

export function trustTarget(target: WorkspaceTarget): WorkspaceTarget {
  return "path" in target ? { kind: target.kind, path: target.path.replace(/\/+$/u, "") } : target;
}

export function kvRef(scope: string, owner: string, key: string): string {
  return `kv/${scope}/${owner}/${key}`;
}

export function leaseRef(id: SessionId, head: HeadName): string {
  return `sessions/${id}/leases/${head}`;
}

export const PROCESSES = "processes/";

export function processRef(instance: string): string {
  return `${PROCESSES}${instance}`;
}

export const JOBS = "jobs/";

export function jobRef(id: JobId): string {
  return `${JOBS}${id}`;
}

export function hostIdentityRef(): string {
  return "host/identity";
}

export function hostPrincipalsRef(): string {
  return "host/principals";
}
