/**
 * The pending change chains behind a head's queue lanes. A lane is a name the
 * submitter chooses; the lanes a head has are the ones its refs name, and which
 * of them lands when is the runner's policy (see `step.ts`), not this file's.
 */
import {
  CANCELLED_PREFIX,
  cancelledRef,
  isLaneName,
  keyRef,
  parseQueueRef,
  queueBaseRef,
  queuePrefix,
  queueTipRef,
} from "./names.ts";
import type { Actor, Change, CommitBody, Obj, Oid, RefUpdate } from "./model.ts";
import type { Objects, Session } from "./store.ts";

const MAX_SUBMIT_ATTEMPTS = 1_000;

export type SubmitOutcome =
  | { readonly kind: "queued"; readonly change: Oid }
  | { readonly kind: "duplicate"; readonly change: Oid };

export type CancelOutcome =
  | { readonly kind: "cancelled" }
  | { readonly kind: "landed" }
  | { readonly kind: "not_found" };

export type RedeliverOutcome =
  | { readonly kind: "redelivered"; readonly change: Oid }
  | { readonly kind: "unchanged" }
  | { readonly kind: "landed" }
  | { readonly kind: "not_found" };

export interface PendingChange {
  readonly oid: Oid;
  readonly change: Change;
  readonly lane: string;
}

export interface NextChange extends PendingChange {
  readonly skipped: readonly Oid[];
}

interface LaneChain {
  readonly lane: string;
  readonly tip: Oid | null;
  readonly base: Oid | null;
  readonly changes: readonly PendingChange[];
}

interface LocatedChange {
  readonly chain: LaneChain;
  readonly item: PendingChange;
}

function isChange(object: Obj): object is Change {
  return object.kind === "change";
}

function validateLane(lane: string): void {
  if (!isLaneName(lane)) throw new TypeError(`Invalid lane name: ${lane}`);
}

function onlyOid(oids: readonly Oid[]): Oid {
  const oid = oids[0];
  if (oid === undefined || oids.length !== 1) {
    throw new Error("Putting one queue object did not return exactly one oid");
  }
  return oid;
}

function twoOids(oids: readonly Oid[]): readonly [Oid, Oid] {
  const first = oids[0];
  const second = oids[1];
  if (first === undefined || second === undefined || oids.length !== 2) {
    throw new Error("Putting two queue objects did not return exactly two oids");
  }
  return [first, second];
}

async function readChange(objects: Objects, oid: Oid): Promise<Change> {
  const object = await objects.get(oid);
  if (object === undefined || !isChange(object)) {
    throw new Error(`Corrupt change chain at ${oid}: missing or non-change object`);
  }
  return object;
}

async function walkLane(
  session: Session,
  options: { readonly head: string; readonly lane: string },
): Promise<LaneChain> {
  const [base, tip] = await Promise.all([
    session.refs.read(queueBaseRef(options.head, options.lane)),
    session.refs.read(queueTipRef(options.head, options.lane)),
  ]);
  const newestFirst: PendingChange[] = [];
  const seen = new Set<Oid>();
  let oid = tip;

  while (oid !== null && oid !== base) {
    if (seen.has(oid)) throw new Error(`Corrupt change chain cycle at ${oid}`);
    seen.add(oid);
    const change = await readChange(session.objects, oid);
    newestFirst.push({ oid, change, lane: options.lane });
    oid = change.previous;
  }

  newestFirst.reverse();
  return { lane: options.lane, tip, base, changes: newestFirst };
}

/** The lanes a head has: every lane one of its queue refs names, in name order. */
export async function listLanes(session: Session, head: string): Promise<readonly string[]> {
  const refs = await session.refs.list(queuePrefix(head));
  const lanes = new Set<string>();
  for (const ref of refs) {
    const parts = parseQueueRef(ref.name);
    if (parts !== undefined && parts.head === head) lanes.add(parts.lane);
  }
  return [...lanes].sort();
}

async function walkLanes(session: Session, head: string): Promise<readonly LaneChain[]> {
  const lanes = await listLanes(session, head);
  return Promise.all(lanes.map((lane) => walkLane(session, { head, lane })));
}

function locate(chains: readonly LaneChain[], target: Oid): LocatedChange | undefined {
  for (const chain of chains) {
    for (const item of chain.changes) {
      if (item.oid === target) return { chain, item };
    }
  }
  return undefined;
}

/** The chain of `lane`, or the empty chain a first submission to it would extend. */
function chainIn(chains: readonly LaneChain[], lane: string): LaneChain {
  for (const chain of chains) {
    if (chain.lane === lane) return chain;
  }
  return { lane, tip: null, base: null, changes: [] };
}

async function reachableFrom(session: Session, tip: Oid | null, target: Oid): Promise<boolean> {
  const seen = new Set<Oid>();
  let oid = tip;

  while (oid !== null) {
    if (seen.has(oid)) throw new Error(`Corrupt change chain cycle at ${oid}`);
    seen.add(oid);
    const change = await readChange(session.objects, oid);
    if (oid === target) return true;
    oid = change.previous;
  }
  return false;
}

async function wasLanded(
  session: Session,
  chains: readonly LaneChain[],
  target: Oid,
): Promise<boolean> {
  const reachable = await Promise.all(
    chains.map((chain) => reachableFrom(session, chain.base, target)),
  );
  return reachable.some((found) => found);
}

function comparePending(left: PendingChange, right: PendingChange): number {
  const byTime = left.change.at - right.change.at;
  if (byTime !== 0) return byTime;
  return left.oid < right.oid ? -1 : left.oid > right.oid ? 1 : 0;
}

export async function submit(
  session: Session,
  options: {
    readonly head: string;
    readonly body: CommitBody;
    /** The lane the change waits in. The runner's landing policy says when that lane lands. */
    readonly lane: string;
    readonly key?: string;
    readonly actor?: Actor;
  },
): Promise<SubmitOutcome> {
  validateLane(options.lane);
  const tipName = queueTipRef(options.head, options.lane);
  const receiptName = options.key === undefined ? undefined : keyRef(options.key);

  if (receiptName !== undefined) {
    const existing = await session.refs.read(receiptName);
    if (existing !== null) return { kind: "duplicate", change: existing };
  }

  for (let attempt = 0; attempt < MAX_SUBMIT_ATTEMPTS; attempt += 1) {
    const tip = await session.refs.read(tipName);
    const baseChange: Change = {
      kind: "change",
      previous: tip,
      body: options.body,
      at: Date.now(),
    };
    const change: Change =
      options.actor === undefined ? baseChange : { ...baseChange, author: options.actor };
    const oid = onlyOid(await session.objects.put([change]));
    const updates: RefUpdate[] = [{ name: tipName, from: tip, to: oid }];
    if (receiptName !== undefined) {
      updates.push({ name: receiptName, from: null, to: oid });
    }

    const updateOptions =
      options.actor === undefined
        ? { reason: "submit" }
        : { reason: "submit", actor: options.actor };
    const outcome = await session.refs.update(updates, updateOptions);
    if (outcome.ok) return { kind: "queued", change: oid };
    if (outcome.reason === "fenced") {
      throw new Error("Unexpected fenced queue submission");
    }
    if (outcome.name === tipName) continue;
    if (receiptName !== undefined && outcome.name === receiptName) {
      if (outcome.actual === null) {
        throw new Error(`Key ref ${receiptName} conflicted without an existing oid`);
      }
      return { kind: "duplicate", change: outcome.actual };
    }
    throw new Error(`Unexpected queue submission conflict on ${outcome.name}`);
  }

  throw new Error(`Queue submission did not settle after ${String(MAX_SUBMIT_ATTEMPTS)} attempts`);
}

export async function cancelledSet(session: Session): Promise<ReadonlySet<Oid>> {
  const refs = await session.refs.list(CANCELLED_PREFIX);
  return new Set(refs.map((ref) => ref.name.slice(CANCELLED_PREFIX.length)));
}

export async function pendingIn(
  session: Session,
  options: { readonly head: string; readonly lane: string },
): Promise<readonly PendingChange[]> {
  validateLane(options.lane);
  const [chain, cancelled] = await Promise.all([walkLane(session, options), cancelledSet(session)]);
  return chain.changes.filter((item) => !cancelled.has(item.oid));
}

export async function pending(session: Session, head: string): Promise<readonly PendingChange[]> {
  const [chains, cancelled] = await Promise.all([walkLanes(session, head), cancelledSet(session)]);
  return chains
    .flatMap((chain) => chain.changes)
    .filter((item) => !cancelled.has(item.oid))
    .sort(comparePending);
}

/**
 * Withdraw a pending change. The tombstone lands in one update with an
 * assertion on its lane's queue base, so a landing that races this cancel
 * makes the update fail and the outcome is re-read: a change is cancelled or
 * landed, never both.
 */
export async function cancel(
  session: Session,
  options: { readonly head: string; readonly change: Oid; readonly actor?: Actor },
): Promise<CancelOutcome> {
  const name = cancelledRef(options.change);
  for (let attempt = 0; attempt < MAX_SUBMIT_ATTEMPTS; attempt += 1) {
    const chains = await walkLanes(session, options.head);
    const located = locate(chains, options.change);
    if (located === undefined) {
      return (await wasLanded(session, chains, options.change))
        ? { kind: "landed" }
        : { kind: "not_found" };
    }
    if ((await session.refs.read(name)) !== null) return { kind: "cancelled" };

    const tombstone = onlyOid(
      await session.objects.put([{ kind: "blob", value: { at: Date.now() } }]),
    );
    const baseName = queueBaseRef(options.head, located.chain.lane);
    const updateOptions =
      options.actor === undefined
        ? { reason: "cancel" }
        : { reason: "cancel", actor: options.actor };
    const outcome = await session.refs.update(
      [
        { name, from: null, to: tombstone },
        { name: baseName, from: located.chain.base, to: located.chain.base },
      ],
      updateOptions,
    );
    if (outcome.ok) return { kind: "cancelled" };
    if (outcome.reason === "fenced") throw new Error("Unexpected fenced queue cancellation");
    if (outcome.name === name && outcome.actual !== null) return { kind: "cancelled" };
    if (outcome.name === baseName) continue;
    throw new Error(`Unexpected queue cancellation conflict on ${outcome.name}`);
  }
  throw new Error(
    `Queue cancellation did not settle after ${String(MAX_SUBMIT_ATTEMPTS)} attempts`,
  );
}

/** Move a pending change between lanes without exposing an intermediate state. */
export async function redeliver(
  session: Session,
  options: {
    readonly head: string;
    readonly change: Oid;
    readonly lane: string;
    readonly actor?: Actor;
  },
): Promise<RedeliverOutcome> {
  validateLane(options.lane);
  const tombstoneName = cancelledRef(options.change);
  for (let attempt = 0; attempt < MAX_SUBMIT_ATTEMPTS; attempt += 1) {
    const chains = await walkLanes(session, options.head);
    const located = locate(chains, options.change);
    if (located === undefined) {
      return (await wasLanded(session, chains, options.change))
        ? { kind: "landed" }
        : { kind: "not_found" };
    }
    if ((await session.refs.read(tombstoneName)) !== null) return { kind: "not_found" };
    if (located.chain.lane === options.lane) return { kind: "unchanged" };

    const target = chainIn(chains, options.lane);
    const baseCopy: Change = {
      kind: "change",
      previous: target.tip,
      supersedes: options.change,
      body: located.item.change.body,
      at: located.item.change.at,
    };
    const copy: Change =
      located.item.change.author === undefined
        ? baseCopy
        : { ...baseCopy, author: located.item.change.author };
    const [tombstone, copied] = twoOids(
      await session.objects.put([{ kind: "blob", value: { at: Date.now() } }, copy]),
    );
    const sourceBaseName = queueBaseRef(options.head, located.chain.lane);
    const targetTipName = queueTipRef(options.head, options.lane);
    const updateOptions =
      options.actor === undefined
        ? { reason: "redeliver" }
        : { reason: "redeliver", actor: options.actor };
    const outcome = await session.refs.update(
      [
        { name: tombstoneName, from: null, to: tombstone },
        {
          name: sourceBaseName,
          from: located.chain.base,
          to: located.chain.base,
        },
        { name: targetTipName, from: target.tip, to: copied },
      ],
      updateOptions,
    );
    if (outcome.ok) return { kind: "redelivered", change: copied };
    if (outcome.reason === "fenced") throw new Error("Unexpected fenced queue redelivery");
    if (
      outcome.name === tombstoneName ||
      outcome.name === sourceBaseName ||
      outcome.name === targetTipName
    ) {
      continue;
    }
    throw new Error(`Unexpected queue redelivery conflict on ${outcome.name}`);
  }
  throw new Error(`Queue redelivery did not settle after ${String(MAX_SUBMIT_ATTEMPTS)} attempts`);
}

/** The oldest live change in the first of `lanes` (in the caller's order) that has one. */
export async function nextToLand(
  session: Session,
  options: { readonly head: string; readonly lanes: readonly string[] },
): Promise<NextChange | undefined> {
  for (const lane of options.lanes) validateLane(lane);
  const cancelled = await cancelledSet(session);
  for (const lane of options.lanes) {
    const chain = await walkLane(session, { head: options.head, lane });
    const skipped: Oid[] = [];
    for (const item of chain.changes) {
      if (cancelled.has(item.oid)) {
        skipped.push(item.oid);
        continue;
      }
      return { ...item, skipped };
    }
  }
  return undefined;
}
