import type { RunClaim } from "../harness/session/store.ts";
import { readSessionConfig } from "../harness/session/context.ts";
import type {
  Entry,
  JsonValue,
  LogItem,
  OperationStartedRecord,
  SessionMetadata,
} from "../harness/session/types.ts";
import { isThinkingLevel } from "../types.ts";
import { projectContextStatus } from "../views/context.ts";
import { sessionDirectoryEntryFromLog } from "../views/directory.ts";
import { transcriptFromEntries } from "../views/transcript.ts";
import {
  MAIN,
  sessionId,
  type HeadInfo,
  type HeadName,
  type PendingItem,
  type RunInfo,
  type Seq,
  type SessionInfo,
  type SessionParent,
  type SessionSnapshot,
} from "./types.ts";

export const PARENT_FACT = "parent";
export const READ_FACT = "read:";

export function parentFromFact(value: JsonValue | undefined): SessionParent | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { sessionId: parentId, runId, callId, agent, depth } = value;
  if (
    typeof parentId !== "string" ||
    typeof runId !== "string" ||
    typeof callId !== "string" ||
    typeof agent !== "string" ||
    typeof depth !== "number"
  ) {
    return undefined;
  }
  return { sessionId: sessionId(parentId), runId, callId, agent, depth };
}

/** Fold the parent link and per-reader read watermarks from the log's fact values. */
function sessionFactsFromLog(log: readonly LogItem[]): {
  parent?: SessionParent;
  readBy?: Readonly<Record<string, Seq>>;
} {
  let parent: SessionParent | undefined;
  let readBy: Record<string, Seq> | undefined;
  for (const item of log) {
    if (item.kind !== "fact_value") continue;
    if (item.fact === PARENT_FACT) {
      parent = parentFromFact(item.value);
      continue;
    }
    if (!item.fact.startsWith(READ_FACT)) continue;
    const reader = item.fact.slice(READ_FACT.length);
    if (item.value === undefined) {
      if (readBy !== undefined) delete readBy[reader];
      continue;
    }
    if (typeof item.value !== "number") continue;
    readBy ??= {};
    readBy[reader] = Math.max(readBy[reader] ?? -1, item.value);
  }
  return {
    ...(parent === undefined ? {} : { parent }),
    ...(readBy === undefined || Object.keys(readBy).length === 0 ? {} : { readBy }),
  };
}

function headLeaves(log: readonly LogItem[]): Map<HeadName, string | null> {
  const leaves = new Map<HeadName, string | null>([[MAIN, null]]);
  for (const item of log) {
    if (item.kind === "head") leaves.set(item.head, item.leafId);
  }
  return leaves;
}

/** Rebuild one branch from the same log and cursor used by the other snapshot projections. */
export function sessionBranchFromLog(log: readonly LogItem[], head: HeadName): Entry[] {
  const leafId = headLeaves(log).get(head) ?? null;
  const entries = new Map<string, Entry>();
  for (const item of log) {
    if (item.kind === "entry") entries.set(item.entry.id, item.entry);
  }

  const branch: Entry[] = [];
  const seen = new Set<string>();
  let current = leafId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const entry = entries.get(current);
    if (entry === undefined) break;
    branch.push(entry);
    current = entry.parentId;
  }
  return branch.reverse();
}

function openOperation(
  log: readonly LogItem[],
  head: HeadName,
): OperationStartedRecord | undefined {
  const finished = new Set<string>();
  for (const item of log) {
    if (item.kind === "record" && item.record.type === "operation_finished") {
      finished.add(item.record.runId);
    }
  }
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const item = log[index];
    if (
      item?.kind === "record" &&
      item.record.type === "operation_started" &&
      item.record.head === head &&
      !finished.has(item.record.id)
    ) {
      return item.record;
    }
  }
  return undefined;
}

function latestClaim(log: readonly LogItem[], head: HeadName): RunClaim | undefined {
  let current: RunClaim | undefined;
  for (const item of log) {
    if (item.kind !== "claim") continue;
    const { event } = item;
    if ("claim" in event) {
      if (event.claim.head === head) current = event.claim;
      continue;
    }
    if (
      current !== undefined &&
      event.head === head &&
      current.runId === event.runId &&
      current.ownerId === event.ownerId &&
      current.fence === event.fence
    ) {
      current = undefined;
    }
  }
  return current;
}

function lastClaimExpiry(log: readonly LogItem[], runId: string): number | undefined {
  let expiry: number | undefined;
  for (const item of log) {
    if (item.kind === "claim" && "claim" in item.event && item.event.claim.runId === runId) {
      expiry = item.event.claim.expiresAtMs;
    }
  }
  return expiry;
}

function currentRunFromLog(
  log: readonly LogItem[],
  head: HeadName,
  now: number,
): RunInfo | undefined {
  const claim = latestClaim(log, head);
  const operation = openOperation(log, head);
  if (claim !== undefined && claim.expiresAtMs > now) {
    return {
      kind: "live",
      runId: claim.runId,
      head,
      startedAt: operation?.timestamp ?? 0,
      claim: { ownerId: claim.ownerId, expiresAt: claim.expiresAtMs },
    };
  }
  if (operation === undefined) return undefined;
  return {
    kind: "orphaned",
    runId: operation.id,
    head,
    startedAt: operation.timestamp,
    expiredAt: lastClaimExpiry(log, operation.id) ?? operation.timestamp,
  };
}

export function sessionInfoFromLog(input: {
  readonly metadata: SessionMetadata;
  readonly log: readonly LogItem[];
  readonly mainBranch?: readonly Entry[];
  readonly now: number;
}): SessionInfo {
  const row = sessionDirectoryEntryFromLog(input);
  const leaves = headLeaves(input.log);
  const heads = row.heads.map((name): HeadInfo => ({
    name,
    entryId: leaves.get(name) ?? null,
    run: currentRunFromLog(input.log, name, input.now),
  }));
  const declared = readSessionConfig(input.mainBranch ?? sessionBranchFromLog(input.log, MAIN));
  return {
    sessionId: sessionId(input.metadata.id),
    name: row.name,
    preview: row.preview,
    createdAt: input.metadata.createdAt,
    lastActivityAt: row.lastActivity,
    heads,
    config: {
      ...(declared.model === undefined ? {} : { model: declared.model }),
      ...(declared.thinkingLevel !== undefined && isThinkingLevel(declared.thinkingLevel)
        ? { thinkingLevel: declared.thinkingLevel }
        : {}),
      ...(declared.agent === undefined ? {} : { agent: declared.agent }),
    },
    ...sessionFactsFromLog(input.log),
  };
}

/** Pending queue projection without activating the session's plugin harness. */
export function pendingItemsFromLog(log: readonly LogItem[]): readonly PendingItem[] {
  const entries = new Set<string>();
  const cancelled = new Set<string>();
  const latestByEntry = new Map<
    string,
    Extract<Extract<LogItem, { kind: "record" }>["record"], { type: "queue_enqueued" }>
  >();

  for (const item of log) {
    if (item.kind === "entry") {
      entries.add(item.entry.id);
      continue;
    }
    if (item.kind !== "record") continue;
    if (item.record.type === "queue_enqueued") {
      latestByEntry.set(item.record.target.id, item.record);
    } else if (item.record.type === "queue_cancelled") {
      cancelled.add(item.record.entryId);
    }
  }

  const pending: PendingItem[] = [];
  for (const record of latestByEntry.values()) {
    if (entries.has(record.target.id) || cancelled.has(record.target.id)) continue;
    const { message } = record.target;
    if (message.role !== "user") continue;
    pending.push({
      entryId: record.target.id,
      delivery: record.queue === "followUp" ? "queue" : record.queue,
      content: message.content,
    });
  }
  return pending;
}

/** One complete client read model, projected from one durable log cursor. */
export function sessionSnapshotFromLog(input: {
  readonly metadata: SessionMetadata;
  readonly log: readonly LogItem[];
  readonly branch: readonly Entry[];
  readonly mainBranch: readonly Entry[];
  readonly contextWindow: number;
  readonly now: number;
}): SessionSnapshot {
  return {
    seq: input.log.at(-1)?.seq ?? -1,
    session: sessionInfoFromLog(input),
    transcript: transcriptFromEntries(input.branch),
    pending: pendingItemsFromLog(input.log),
    context: projectContextStatus(input.branch, input.contextWindow),
  };
}
