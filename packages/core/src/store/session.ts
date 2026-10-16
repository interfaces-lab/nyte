import { asId } from "@nyte-ai/schema";
import type {
  CallId,
  CommitId,
  DurableEvent,
  ExecutionCoverage,
  HeadInfo,
  HeadName,
  Json,
  MessageId,
  MoveOutcome,
  ObjectId,
  Position,
  Ref,
  Revision,
  RunId,
  SessionId,
} from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import {
  decodeCallRecord,
  decodeCommitRecord,
  decodeInboxRecord,
  decodeKvValue,
  decodeReceiptRecord,
  decodeRunRecord,
  decodeSessionRecord,
  envelope,
} from "../contract/records.ts";
import type {
  CallRecord,
  CommitRecord,
  InboxRecord,
  ReceiptRecord,
  RecordKind,
  RunRecord,
  SessionRecord,
} from "../contract/records.ts";
import { dev } from "../util/dev-log.ts";
import { SdkError } from "../util/error.ts";
import { callRef, headRef, inboxRef, receiptRef, sessionRef } from "./refs.ts";

export const MAIN: HeadName = asId<"head">("main");

export const EMPTY_REVISION: Revision = asId<"revision">("");

export const START: Position = { kind: "start" };

export const STALE: unique symbol = Symbol("stale");

const WRITE_TRIES = 8;

const WRITE_BACKOFF_MS = 5;

export interface Found<T> {
  readonly ref: Ref;
  readonly record: T;
}

export interface Tip {
  readonly ref: Ref | null;
  readonly id: CommitId | null;
  readonly commit: CommitRecord | null;
}

export interface Inbox extends InboxRecord {
  readonly ref: Ref | null;
}

export type MoveFailure = Exclude<MoveOutcome, { readonly kind: "moved" }>;

const SESSION_PAGE = 100;

export async function load<T>(
  kernel: Kernel,
  ref: Ref | null,
  decode: (object: Json | null) => T | null,
): Promise<Found<T> | null> {
  if (ref === null || ref.target === null) return null;
  const record = decode(await kernel.store.objects.get(ref.target));

  if (record === null)
    throw new SdkError("internal", `${ref.name} does not hold the record its name says.`);

  return { ref, record };
}

export async function readSession(
  kernel: Kernel,
  session: SessionId,
): Promise<Found<SessionRecord> | null> {
  return load(kernel, await kernel.store.refs.get(sessionRef(session)), decodeSessionRecord);
}

export async function requireSession(
  kernel: Kernel,
  session: SessionId,
): Promise<Found<SessionRecord>> {
  const found = await readSession(kernel, session);

  if (found === null) throw new SdkError("unknown", `No session has the id ${session}.`);

  return found;
}

export async function readReceipt(
  kernel: Kernel,
  session: SessionId,
  id: string,
): Promise<Found<ReceiptRecord> | null> {
  return load(
    kernel,
    await kernel.store.refs.get(receiptRef(session, asId<"receipt">(id))),
    decodeReceiptRecord,
  );
}

export async function readTip(kernel: Kernel, session: SessionId, head: HeadName): Promise<Tip> {
  const ref = await kernel.store.refs.get(headRef(session, head));

  return {
    ref,
    id: ref === null || ref.target === null ? null : asId<"commit">(ref.target),
    commit: (await load(kernel, ref, decodeCommitRecord))?.record ?? null,
  };
}

export async function readInbox(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<Inbox> {
  const ref = await kernel.store.refs.get(inboxRef(session, head));

  const record = (await load(kernel, ref, decodeInboxRecord))?.record;

  return { ref, messages: record?.messages ?? [], pendingInput: record?.pendingInput ?? [] };
}

export function inboxWithout(inbox: Inbox, ids: readonly MessageId[]): InboxRecord {
  return {
    messages: inbox.messages.filter((message) => !ids.includes(message)),
    pendingInput: inbox.pendingInput.filter((message) => !ids.includes(message)),
  };
}

export async function liveRuns(
  kernel: Kernel,
  session: SessionId,
): Promise<readonly Found<RunRecord>[]> {
  const refs = await kernel.store.refs.list(`${sessionRef(session)}/runs/`);
  const runs = await Promise.all(refs.map((ref) => load(kernel, ref, decodeRunRecord)));

  return runs.flatMap((run) => (run === null ? [] : [run]));
}

export async function liveRun(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<Found<RunRecord> | null> {
  return (await liveRuns(kernel, session)).find((run) => run.record.view.head === head) ?? null;
}

export function readRefExpectation(ref: Ref | null): Revision | "absent" {
  return ref === null ? "absent" : ref.revision;
}

export function sameRevision(expect: Revision, ref: Ref | null): boolean {
  return expect === EMPTY_REVISION ? ref === null : ref?.revision === expect;
}

export async function staleHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<MoveFailure> {
  return {
    kind: "stale",
    revision: (await readTip(kernel, session, head)).ref?.revision ?? EMPTY_REVISION,
  };
}

export async function put(
  kernel: Kernel,
  kind: RecordKind,
  body: Json,
  at = Date.now(),
): Promise<ObjectId> {
  const object = envelope(kind, body, at);
  const id = await kernel.store.objects.put(object);
  dev("store", "objects.put", { id, kind, bytes: dev.bytes(object) });

  return id;
}

/** Runs a compare-and-set write until it lands, backing off with jitter after each lost race; a write that keeps losing fails `stale` rather than spinning. */
export async function attempt<T>(what: string, write: () => Promise<T | typeof STALE>): Promise<T> {
  for (let tries = 1; ; tries += 1) {
    const result = await write();

    if (result !== STALE) return result;
    dev("store", "lost", { what, tries });

    if (tries === WRITE_TRIES)
      throw new SdkError("stale", `${what} lost to concurrent writes ${WRITE_TRIES} times.`);
    const backoff = WRITE_BACKOFF_MS * 2 ** (tries - 1) * (0.5 + Math.random());
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }
}

export function walkCommitPath(
  commits: ReadonlyMap<CommitId, CommitRecord>,
  tip: CommitId | null,
): readonly CommitId[] {
  const path: CommitId[] = [];
  const seen = new Set<CommitId>();
  let cursor = tip;

  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const record = commits.get(cursor);

    if (record === undefined) break;
    path.push(cursor);
    cursor = record.parent;
  }

  return path.reverse();
}

export function readPositionCommit(position: Position): CommitId | null {
  return position.kind === "commit" ? position.id : null;
}

export function createPosition(commit: CommitId | null): Position {
  return commit === null ? START : { kind: "commit", id: commit };
}

export function toCommitObjectId(commit: CommitId): ObjectId {
  return asId<"object">(commit);
}

export async function readCommit(kernel: Kernel, commit: CommitId): Promise<CommitRecord | null> {
  return decodeCommitRecord(await kernel.store.objects.get(toCommitObjectId(commit)));
}

export async function readCall(
  kernel: Kernel,
  session: SessionId,
  call: CallId,
): Promise<Found<CallRecord> | null> {
  return load(kernel, await kernel.store.refs.get(callRef(session, call)), decodeCallRecord);
}

export async function readCalls(
  kernel: Kernel,
  session: SessionId,
): Promise<readonly CallRecord[]> {
  const refs = await kernel.store.refs.list(`${sessionRef(session)}/calls/`);
  const calls = await Promise.all(refs.map((ref) => load(kernel, ref, decodeCallRecord)));

  return calls.flatMap((call) => (call === null ? [] : [call.record]));
}

export async function covers(
  kernel: Kernel,
  coverage: ExecutionCoverage,
  session: SessionId,
): Promise<boolean> {
  if (coverage.kind === "all") return true;
  let current = await readSession(kernel, session);

  if (coverage.kind === "workspace") return current?.record.workspace === coverage.workspace;
  while (current !== null) {
    if (coverage.sessions.includes(current.record.id)) return true;
    const parent = current.record.parent;
    current = parent === null ? null : await readSession(kernel, parent);
  }

  return false;
}

/** Every session record, most recently active first. Paged, not a snapshot: a session that becomes active mid-scan sorts ahead of the cursor and can be missed. */
export async function listSessionRecords(kernel: Kernel): Promise<readonly SessionRecord[]> {
  const records: SessionRecord[] = [];
  let after: { readonly at: number; readonly id: SessionId } | undefined;

  for (;;) {
    const refs = await kernel.store.sessions.list({
      parents: { kind: "all" },
      after,
      limit: SESSION_PAGE,
    });
    const found = await Promise.all(refs.map(({ ref }) => load(kernel, ref, decodeSessionRecord)));
    const page = found.flatMap((entry) => (entry === null ? [] : [entry.record]));
    records.push(...page);
    const last = page.at(-1);

    if (refs.length < SESSION_PAGE || last === undefined) return records;
    after = { at: last.lastActivityAt, id: last.id };
  }
}

export async function coveredSessions(
  kernel: Kernel,
  coverage: Exclude<ExecutionCoverage, { readonly kind: "all" }>,
): Promise<readonly SessionRecord[]> {
  if (coverage.kind === "sessions" && coverage.sessions.length === 0) return [];
  const records = await listSessionRecords(kernel);

  if (coverage.kind === "workspace")
    return records.filter((record) => record.workspace === coverage.workspace);
  const included = new Set(coverage.sessions);
  let grew = true;

  while (grew) {
    grew = false;

    for (const record of records)
      if (!included.has(record.id) && record.parent !== null && included.has(record.parent)) {
        included.add(record.id);
        grew = true;
      }
  }

  return records.filter((record) => included.has(record.id));
}

export async function isCovered(kernel: Kernel, session: SessionId): Promise<boolean> {
  if (kernel.execution.kind === "dispatch") return true;

  if (kernel.execution.kind === "run" && (await covers(kernel, kernel.execution.coverage, session)))
    return true;

  for (const coverage of kernel.executionState.covers.values())
    if (await covers(kernel, coverage, session)) return true;

  return false;
}

export async function sessionEvent(
  kernel: Kernel,
  record: SessionRecord,
  rows?: ReadonlyMap<HeadName, Partial<HeadInfo>>,
): Promise<DurableEvent> {
  const heads = record.heads.map((head): HeadInfo => ({
    name: head.name,
    tip: START,
    stack: head.stack,
    execution: { kind: "idle", lastRun: head.lastRun },
    unread: false,
    ...rows?.get(head.name),
  }));

  return {
    head: null,
    kind: "session",
    info: {
      id: record.id,
      name: record.name,
      parent: record.parent,
      call: record.origin?.call ?? null,
      workspace: record.workspace,
      pinned: record.pinned,
      archived: record.archived,
      activation: kernel.activation(record.id),
      heads,
      createdAt: record.createdAt,
      lastActivityAt: record.lastActivityAt,
    },
  };
}

interface Guarded {
  readonly tip: Tip;
  readonly inbox: Inbox;
  readonly run: RunId | null;
}

export async function guard(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  expect: Revision | undefined,
  running: "refuse" | "stop",
): Promise<MoveFailure | Guarded> {
  const [tip, inbox, run] = await Promise.all([
    readTip(kernel, session, head),
    readInbox(kernel, session, head),
    liveRun(kernel, session, head),
  ]);

  if (expect !== undefined && !sameRevision(expect, tip.ref))
    return { kind: "stale", revision: tip.ref?.revision ?? EMPTY_REVISION };

  if (run !== null && running === "refuse") return { kind: "busy", run: run.record.view.id };

  const pending = inbox.messages.filter((message) => inbox.pendingInput.includes(message));

  if (pending.length > 0) return { kind: "pending-input", messages: pending };

  return { tip, inbox, run: run?.record.view.id ?? null };
}

export async function readKv(kernel: Kernel, name: string): Promise<Json | undefined> {
  const ref = await kernel.store.refs.get(name);

  return ref === null || ref.target === null
    ? undefined
    : decodeKvValue(await kernel.store.objects.get(ref.target));
}
