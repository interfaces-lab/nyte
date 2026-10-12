import { asId } from "@nyte-ai/schema";
import type {
  CallId,
  CommitId,
  Disposer,
  DurableEvent,
  ExecutionCoverage,
  HeadInfo,
  HeadName,
  Json,
  MessageId,
  MoveOutcome,
  ObjectId,
  PartId,
  Position,
  Ref,
  RefUpdate,
  Revision,
  RunId,
  SessionId,
  SetOutcome,
  UserContent,
} from "@nyte-ai/schema";
import { SdkError } from "./error.ts";
import { dev } from "./dev-log.ts";
import type { FoldState } from "./fold.ts";
import type { Kernel } from "./kernel.ts";
import { LOCAL } from "./principals.ts";
import {
  decodeCallRecord,
  decodeCommitRecord,
  decodeInboxRecord,
  decodeReceiptRecord,
  decodeRunRecord,
  decodeSessionRecord,
  envelope,
} from "./records.ts";
import type {
  CallRecord,
  CommitRecord,
  ReceiptRecord,
  RecordKind,
  RunRecord,
  SessionRecord,
} from "./records.ts";
import { callRef, headRef, inboxRef, receiptRef, sessionRef } from "./refs.ts";
import { sessionInfo } from "./session.ts";
import { publishSet } from "./watch.ts";

/** The head every session has; "main" is the session itself. */
export const MAIN: HeadName = asId<"head">("main");

/** The revision of a ref that does not exist yet; every `expect` treats it as `"absent"`. */
export const EMPTY_REVISION: Revision = asId<"revision">("");

/** The position before the first commit. */
export const START: Position = { kind: "start" };

/** What a write returns when its compare-and-set lost, so `attempt` re-reads and tries again. */
export const STALE: unique symbol = Symbol("stale");

/** Returns a ref with the record its object holds. */
export interface Found<T> {
  readonly ref: Ref;
  readonly record: T;
}

/** Returns a head's ref, the commit it points at and that commit's id; all null at the start. */
export interface Tip {
  readonly ref: Ref | null;
  readonly id: CommitId | null;
  readonly commit: CommitRecord | null;
}

/** Returns a head's inbox ref and the admitted inputs it lists, in order. */
export interface Inbox {
  readonly ref: Ref | null;
  readonly messages: readonly MessageId[];
}

/** Returns the outcomes a move or an edit settles with when nothing moved. */
export type MoveFailure = Exclude<MoveOutcome, { readonly kind: "moved" }>;

/** Returns the next state of a call record and what lands in the same set: the event its own entry carries and further ref updates. */
export interface CallChange {
  readonly record: CallRecord;
  readonly event?: DurableEvent;
  readonly updates?: readonly RefUpdate[];
}

const CALL_TRIES = 8;

/** Returns the record a ref's object holds, or null when the ref is absent; throws `internal` when the object is another record. */
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

/** Returns the session record and its ref, or null when the session does not exist. */
export async function readSession(
  kernel: Kernel,
  session: SessionId,
): Promise<Found<SessionRecord> | null> {
  return load(kernel, await kernel.store.refs.get(sessionRef(session)), decodeSessionRecord);
}

/** Returns the session record and its ref; throws `unknown` when the session does not exist. */
export async function requireSession(
  kernel: Kernel,
  session: SessionId,
): Promise<Found<SessionRecord>> {
  const found = await readSession(kernel, session);

  if (found === null) throw new SdkError("unknown", `No session has the id ${session}.`);

  return found;
}

/** Returns the receipt record and its ref, or null when the host does not have it. */
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

/** Returns a head's ref and tip commit. */
export async function readTip(kernel: Kernel, session: SessionId, head: HeadName): Promise<Tip> {
  const ref = await kernel.store.refs.get(headRef(session, head));

  return {
    ref,
    id: ref === null || ref.target === null ? null : asId<"commit">(ref.target),
    commit: (await load(kernel, ref, decodeCommitRecord))?.record ?? null,
  };
}

/** Returns a head's inbox ref and its inputs in order. */
export async function readInbox(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<Inbox> {
  const ref = await kernel.store.refs.get(inboxRef(session, head));

  return { ref, messages: (await load(kernel, ref, decodeInboxRecord))?.record.messages ?? [] };
}

/** Returns every run record whose ref exists: the runs live in the session. */
export async function liveRuns(
  kernel: Kernel,
  session: SessionId,
): Promise<readonly Found<RunRecord>[]> {
  const refs = await kernel.store.refs.list(`${sessionRef(session)}/runs/`);
  const runs = await Promise.all(refs.map((ref) => load(kernel, ref, decodeRunRecord)));

  return runs.flatMap((run) => (run === null ? [] : [run]));
}

/** Returns the run live on a head, or null when the head is idle. */
export async function liveRun(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
): Promise<Found<RunRecord> | null> {
  return (await liveRuns(kernel, session)).find((run) => run.record.view.head === head) ?? null;
}

/** Returns the `expect` that holds a ref where it is: its revision, or `"absent"`. */
export function expectOf(ref: Ref | null): Revision | "absent" {
  return ref === null ? "absent" : ref.revision;
}

/** Returns whether a client's `expect` still matches a ref; the empty revision matches only an absent ref. */
export function sameRevision(expect: Revision, ref: Ref | null): boolean {
  return expect === EMPTY_REVISION ? ref === null : ref?.revision === expect;
}

/** Returns a move's `stale` outcome: the head ref's current revision. */
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

/** Writes a new receipt record, pending or already settled; throws `stale` when the id exists. */
export async function writeReceipt(
  kernel: Kernel,
  session: SessionId,
  record: ReceiptRecord,
): Promise<void> {
  const outcome = await commit(kernel, [
    {
      name: receiptRef(session, record.id),
      target: await put(kernel, "receipt", record),
      expect: "absent",
    },
  ]);

  if (outcome.kind === "stale") throw new SdkError("stale", `Receipt ${record.id} already exists.`);
}

/** Stores a record in its envelope and returns its object id. */
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

/** Publishes one batch and its events: the one `refs.set` of a durable change. */
export async function commit(kernel: Kernel, updates: readonly RefUpdate[]): Promise<SetOutcome> {
  const outcome = await kernel.store.refs.set(updates);
  dev("store", "refs.set", { names: updates.map(({ name }) => name), outcome });
  await publishSet(kernel, updates, outcome);

  return outcome;
}

/** Runs a read-then-write until it wins: a lost compare-and-set means another write landed, so it reads again. */
export async function attempt<T>(what: string, write: () => Promise<T | typeof STALE>): Promise<T> {
  for (;;) {
    const result = await write();

    if (result !== STALE) return result;
    dev("store", "lost", { what });
  }
}

/** Reads the session's shared fold, as the host sees it, without keeping it. */
export async function withFold<T>(
  kernel: Kernel,
  session: SessionId,
  read: (state: FoldState) => T,
): Promise<T> {
  const hold = kernel.folds.acquire(session, LOCAL);

  try {
    await hold.ready();

    return read(hold.state());
  } finally {
    hold.release();
  }
}

/** Returns the ids of the commits from the root to a tip, oldest first. */
export function pathOf(
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

/** Returns the commit a position names, or null at the start. */
export function tipOf(position: Position): CommitId | null {
  return position.kind === "commit" ? position.id : null;
}

/** Returns the position of a commit, or the start for null. */
export function positionOf(commit: CommitId | null): Position {
  return commit === null ? START : { kind: "commit", id: commit };
}

/** Stores a commit in its envelope and returns its id: the object id the store returned. */
export async function putCommit(kernel: Kernel, record: CommitRecord): Promise<CommitId> {
  const object = envelope("commit", record, record.at, record.parent);
  const id = asId<"commit">(await kernel.store.objects.put(object));
  dev("store", "objects.put", { id, kind: "commit", bytes: dev.bytes(object) });

  return id;
}

/** Returns the object a commit is stored as: the object whose id is the commit's. */
export function objectOf(commit: CommitId): ObjectId {
  return asId<"object">(commit);
}

/** Returns the commit stored under an id, or null when no commit has it. */
export async function readCommit(kernel: Kernel, commit: CommitId): Promise<CommitRecord | null> {
  return decodeCommitRecord(await kernel.store.objects.get(objectOf(commit)));
}

/** Returns, by run, the messages this process landed into it; `endRun` settles their receipts. */
export function landedIn(kernel: Kernel): Map<RunId, MessageId[]> {
  return kernel.executionState.landedRuns;
}

/** Returns a durable step's call record and its ref, or null when the step has none. */
export async function readCall(
  kernel: Kernel,
  session: SessionId,
  call: CallId,
): Promise<Found<CallRecord> | null> {
  return load(kernel, await kernel.store.refs.get(callRef(session, call)), decodeCallRecord);
}

/** Returns every call record in a session. */
export async function readCalls(
  kernel: Kernel,
  session: SessionId,
): Promise<readonly CallRecord[]> {
  const refs = await kernel.store.refs.list(`${sessionRef(session)}/calls/`);
  const calls = await Promise.all(refs.map((ref) => load(kernel, ref, decodeCallRecord)));

  return calls.flatMap((call) => (call === null ? [] : [call.record]));
}

/** Returns the parts of a run the session's log shows live or waiting: the candidates a run's fence or end fails, each re-read by the write. */
export function liveParts(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<readonly PartId[]> {
  return withFold(kernel, session, (state) =>
    [...state.parts.values()].flatMap((part) =>
      part.run === run && (part.status.kind === "live" || part.status.kind === "waiting")
        ? [part.id]
        : [],
    ),
  );
}

/** Changes a call record one change at a time per call in this process: reads it (null when absent), asks `change` for the next state, and compare-and-sets it with the change's updates in one set; a lost race reads and asks again. Resolves the record as written, or as read when `change` returned null, and whether it wrote. */
export function changeCall(
  kernel: Kernel,
  session: SessionId,
  call: CallId,
  change: (current: CallRecord | null) => Promise<CallChange | null>,
): Promise<{ readonly record: CallRecord | null; readonly wrote: boolean }> {
  const name = callRef(session, call);
  const queues = kernel.executionState.callQueues;

  const done = (queues.get(name) ?? Promise.resolve()).then(async () => {
    for (let tries = 0; tries < CALL_TRIES; tries += 1) {
      const found = await readCall(kernel, session, call);
      const next = await change(found?.record ?? null);

      if (next === null) return { record: found?.record ?? null, wrote: false };

      const outcome = await commit(kernel, [
        {
          name,
          target: await put(kernel, "call", next.record),
          expect: expectOf(found?.ref ?? null),
          event: next.event,
        },
        ...(next.updates ?? []),
      ]);

      if (outcome.kind === "set") return { record: next.record, wrote: true };
    }

    throw new SdkError("stale", `Call ${call} lost to concurrent writes ${CALL_TRIES} times.`);
  });

  const settled = done.then(
    () => undefined,
    () => undefined,
  );

  queues.set(name, settled);
  void settled.then(() => {
    if (queues.get(name) === settled) queues.delete(name);
  });

  return done;
}

/** Returns whether a coverage includes a session: every session, its workspace, or it or an ancestor listed (§42ac: `sessions` names sessions and their descendants). */
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

/** Records a coverage an in-process driver or an open `cover` runs while it is open, so `isCovered` counts it on a kernel whose own execution is `admit-only` (§41b, §42a); the disposer removes it. */
export function addDriven(kernel: Kernel, coverage: ExecutionCoverage): Disposer {
  const coverages = kernel.executionState.driven;
  const entry = { ...coverage };
  coverages.add(entry);

  return () => {
    coverages.delete(entry);
  };
}

/** Returns whether this host runs a session: always on a `dispatch` kernel (§42p), else when its own `run` coverage or an open driver's or `cover`'s coverage includes it. */
export async function isCovered(kernel: Kernel, session: SessionId): Promise<boolean> {
  if (kernel.execution.kind === "dispatch") return true;

  if (kernel.execution.kind === "run" && (await covers(kernel, kernel.execution.coverage, session)))
    return true;

  for (const coverage of kernel.executionState.driven)
    if (await covers(kernel, coverage, session)) return true;

  return false;
}

/** Hands a head owed a step to a `dispatch` kernel's dispatcher (§42s): at most one dispatch per head in flight in this instance, a later wake while it is pending dropped; a rejected one is recorded nowhere, the head staying owed for `repair`. */
export function dispatchHead(
  kernel: Kernel,
  execution: Extract<Kernel["execution"], { readonly kind: "dispatch" }>,
  session: SessionId,
  head: HeadName,
): void {
  const inFlight = kernel.executionState.pending;
  const key = JSON.stringify([session, head]);

  if (inFlight.has(key)) return;
  inFlight.add(key);
  dev("execution", "dispatch", { session, head });

  void Promise.resolve()
    .then(() => execution.dispatch({ session, head }))
    .catch(() => undefined)
    .finally(() => inFlight.delete(key));
}

/** Returns the `session` event for a record about to be written: the current directory row with the record's fields and heads, and `rows` laid over named heads. */
export async function sessionEvent(
  kernel: Kernel,
  record: SessionRecord,
  rows?: ReadonlyMap<HeadName, Partial<HeadInfo>>,
): Promise<DurableEvent> {
  const before = await sessionInfo(kernel, record.id, LOCAL);

  const heads = record.heads.map((head): HeadInfo => {
    const row: HeadInfo = before?.heads.find((current) => current.name === head.name) ?? {
      name: head.name,
      tip: START,
      stack: head.stack,
      execution: { kind: "idle", lastRun: head.lastRun },
      unread: false,
    };

    return { ...row, stack: head.stack, ...rows?.get(head.name) };
  });

  return {
    head: null,
    kind: "session",
    info: {
      id: record.id,
      name: record.name,
      parent: record.parent,
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

/** Returns the text items of user content joined, or the string itself. */
export function textOf(content: UserContent): string {
  if (typeof content === "string") return content;

  return content.flatMap((item) => (item.kind === "text" ? [item.text] : [])).join(" ");
}

/** Returns whether a value is a JSON object. */
export function isJsonObject(value: Json | undefined): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
