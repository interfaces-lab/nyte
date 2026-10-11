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
  Position,
  Ref,
  RefUpdate,
  Revision,
  RunId,
  SessionId,
  SetOutcome,
  UserContent,
  WaitTarget,
} from "@nyte-ai/schema";
import { publishSet } from "./bus.ts";
import { SdkError } from "./error.ts";
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
import { callRef, headRef, inboxRef, receiptRef, runRef, sessionRef } from "./refs.ts";
import { sessionInfo } from "./session-info.ts";

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

const landedRuns = new WeakMap<Kernel, Map<RunId, MessageId[]>>();

const callQueues = new WeakMap<Kernel, Map<string, Promise<unknown>>>();

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

/** Checks what a move or an edit needs of a head, in order: `expect` holds, no live run unless `running` is stop, an empty inbox; returns the failure, or the tip and the run to stop. */
export async function guardHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  expect: Revision | undefined,
  running: "refuse" | "stop",
): Promise<MoveFailure | { readonly tip: Tip; readonly run: RunId | null }> {
  const [tip, inbox, run] = await Promise.all([
    readTip(kernel, session, head),
    readInbox(kernel, session, head),
    liveRun(kernel, session, head),
  ]);

  if (expect !== undefined && !sameRevision(expect, tip.ref))
    return { kind: "stale", revision: tip.ref?.revision ?? EMPTY_REVISION };

  if (run !== null && running === "refuse") return { kind: "busy", run: run.record.view.id };

  if (inbox.messages.length > 0) return { kind: "pending-input", messages: inbox.messages };

  return { tip, run: run?.record.view.id ?? null };
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
export function put(
  kernel: Kernel,
  kind: RecordKind,
  body: Json,
  at = Date.now(),
): Promise<ObjectId> {
  return kernel.store.objects.put(envelope(kind, body, at));
}

/** Publishes one batch and its events: the one `refs.set` of a durable change. */
export async function commit(kernel: Kernel, updates: readonly RefUpdate[]): Promise<SetOutcome> {
  const outcome = await kernel.store.refs.set(updates);
  await publishSet(kernel, updates, outcome);

  return outcome;
}

/** Runs a read-then-write once, and once more after a lost compare-and-set; throws `stale` when it loses twice. */
export async function attempt<T>(what: string, write: () => Promise<T | typeof STALE>): Promise<T> {
  for (let tries = 0; tries < 2; tries += 1) {
    const result = await write();

    if (result !== STALE) return result;
  }

  throw new SdkError("stale", `${what} lost to a concurrent write twice.`);
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
  return asId<"commit">(
    await kernel.store.objects.put(envelope("commit", record, record.at, record.parent)),
  );
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
  const known = landedRuns.get(kernel) ?? new Map<RunId, MessageId[]>();
  landedRuns.set(kernel, known);

  return known;
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

/** Returns the update that marks a live run waiting on a target with `run waiting`, or none once the run has ended. */
export async function runWaiting(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  on: WaitTarget,
): Promise<readonly RefUpdate[]> {
  const name = runRef(session, run);
  const found = await load(kernel, await kernel.store.refs.get(name), decodeRunRecord);

  if (found === null) return [];

  return [
    {
      name,
      target: await put(kernel, "run", { ...found.record, waiting: on }),
      expect: found.ref.revision,
      event: { head: found.record.view.head, kind: "run", run, change: "waiting", on },
    },
  ];
}

/** Changes a call record one change at a time per call in this process: reads it (null when absent), asks `change` for the next state, and compare-and-sets it with the change's updates in one set; a lost race reads and asks again. Resolves the record as written, or as read when `change` returned null, and whether it wrote. */
export function changeCall(
  kernel: Kernel,
  session: SessionId,
  call: CallId,
  change: (current: CallRecord | null) => Promise<CallChange | null>,
): Promise<{ readonly record: CallRecord | null; readonly wrote: boolean }> {
  const name = callRef(session, call);
  const queues = callQueues.get(kernel) ?? new Map<string, Promise<unknown>>();
  callQueues.set(kernel, queues);

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
  const seen = new Set<SessionId>();

  while (current !== null && !seen.has(current.record.id)) {
    if (coverage.sessions.includes(current.record.id)) return true;
    seen.add(current.record.id);
    const parent = current.record.parent;
    current = parent === null ? null : await readSession(kernel, parent);
  }

  return false;
}

const driven = new WeakMap<Kernel, Set<ExecutionCoverage>>();

const pending = new WeakMap<Kernel, Set<string>>();

const dispatched = new WeakMap<Kernel, Set<SessionId>>();

/** Records a coverage an in-process driver or an open `cover` runs while it is open, so `isCovered` counts it on a kernel whose own execution is `admit-only` (§41b, §42a); the disposer removes it. */
export function addDriven(kernel: Kernel, coverage: ExecutionCoverage): Disposer {
  const coverages = driven.get(kernel) ?? new Set<ExecutionCoverage>();
  const entry = { ...coverage };
  coverages.add(entry);
  driven.set(kernel, coverages);

  return () => {
    coverages.delete(entry);
  };
}

/** Returns whether this host runs a session: execution is `run` and its coverage includes it, an open driver's or `cover`'s coverage includes it, or a `dispatch` for it resolved in this instance (§42p). */
export async function isCovered(kernel: Kernel, session: SessionId): Promise<boolean> {
  if (kernel.execution.kind === "run" && (await covers(kernel, kernel.execution.coverage, session)))
    return true;

  for (const coverage of driven.get(kernel) ?? [])
    if (await covers(kernel, coverage, session)) return true;

  return dispatched.get(kernel)?.has(session) ?? false;
}

/** Returns whether a session's environment attaches here: on a `dispatch` kernel always, as for `run` (§42p), else when `isCovered` says so. What activation and a plugin's `api.env` read. */
export async function attachesHere(kernel: Kernel, session: SessionId): Promise<boolean> {
  return kernel.execution.kind === "dispatch" || isCovered(kernel, session);
}

/** Hands a head owed a step to a `dispatch` kernel's dispatcher (§42s): at most one dispatch per head in flight in this instance, a later wake while it is pending dropped; a resolved dispatch makes its session count for `isCovered`, a rejected one is recorded nowhere, the head staying owed for `repair`. Does nothing on any other kernel. */
export function dispatchHead(kernel: Kernel, session: SessionId, head: HeadName): void {
  const execution = kernel.execution;

  if (execution.kind !== "dispatch") return;
  const inFlight = pending.get(kernel) ?? new Set<string>();
  pending.set(kernel, inFlight);
  const key = JSON.stringify([session, head]);

  if (inFlight.has(key)) return;
  inFlight.add(key);

  void Promise.resolve()
    .then(() => execution.dispatch({ session, head }))
    .then(
      () => {
        const sessions = dispatched.get(kernel) ?? new Set<SessionId>();
        dispatched.set(kernel, sessions);
        sessions.add(session);
      },
      () => undefined,
    )
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
