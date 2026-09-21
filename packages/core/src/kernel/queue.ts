/** The two pending chains behind a head's inbox. */
import { validateHeadName, type Delivery } from "@nyte-ai/protocol";
import { mergeByDelivery } from "@nyte-ai/client";
import {
  CANCELLED_PREFIX,
  cancelledRef,
  isDelivery,
  keyRef,
  parseInboxRef,
  inboxBaseRef,
  inboxPrefix,
  inboxTipRef,
} from "./names.ts";
import type { Actor, Change, ChangeBody, Obj, Oid, RefUpdate } from "./model.ts";
import type { Objects, Session } from "./store.ts";
import type { UserMessage } from "@nyte-ai/schema";

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
  readonly delivery: Delivery;
}

export interface NextChange extends PendingChange {
  readonly skipped: readonly Oid[];
}

interface DeliveryChain {
  readonly delivery: Delivery;
  readonly tip: Oid | null;
  readonly base: Oid | null;
  readonly changes: readonly PendingChange[];
}

interface LocatedChange {
  readonly chain: DeliveryChain;
  readonly item: PendingChange;
}

function isChange(object: Obj): object is Change {
  return "type" in object && object.type === "change";
}

function validateDelivery(delivery: string): void {
  if (!isDelivery(delivery)) throw new TypeError(`Invalid delivery name: ${delivery}`);
}

function onlyOid(oids: readonly Oid[]): Oid {
  const oid = oids[0];
  if (oid === undefined || oids.length !== 1) {
    throw new Error("Putting one queue object did not return exactly one oid");
  }
  return oid;
}

async function readChange(objects: Objects, oid: Oid): Promise<Change> {
  const object = await objects.get(oid);
  if (object === undefined || !isChange(object)) {
    throw new Error(`Corrupt change chain at ${oid}: missing or non-change object`);
  }
  return object;
}

async function walkDelivery(
  session: Session,
  options: { readonly head: string; readonly delivery: Delivery },
): Promise<DeliveryChain> {
  const [base, tip] = await Promise.all([
    session.refs.read(inboxBaseRef(options.head, options.delivery)),
    session.refs.read(inboxTipRef(options.head, options.delivery)),
  ]);
  const newestFirst: PendingChange[] = [];
  const seen = new Set<Oid>();
  let oid = tip;

  while (oid !== null && oid !== base) {
    if (seen.has(oid)) throw new Error(`Corrupt change chain cycle at ${oid}`);
    seen.add(oid);
    const change = await readChange(session.objects, oid);
    if (change.delivery !== options.delivery) {
      throw new Error(`Change ${oid} is in ${options.delivery} but stamped ${change.delivery}`);
    }
    newestFirst.push({ oid, change, delivery: options.delivery });
    oid = change.previous;
  }

  newestFirst.reverse();
  return { delivery: options.delivery, tip, base, changes: newestFirst };
}

/** The deliveries for which this head has inbox refs. */
export async function listDeliveries(session: Session, head: string): Promise<readonly Delivery[]> {
  const refs = await session.refs.list(inboxPrefix(head));
  const deliveries = new Set<Delivery>();
  for (const ref of refs) {
    const parts = parseInboxRef(ref.name);
    if (parts !== undefined && parts.head === head) deliveries.add(parts.delivery);
  }
  return [...deliveries].sort();
}

async function walkDeliveries(session: Session, head: string): Promise<readonly DeliveryChain[]> {
  const deliveries = await listDeliveries(session, head);
  return Promise.all(deliveries.map((delivery) => walkDelivery(session, { head, delivery })));
}

function locate(chains: readonly DeliveryChain[], target: Oid): LocatedChange | undefined {
  for (const chain of chains) {
    for (const item of chain.changes) {
      if (item.oid === target) return { chain, item };
    }
  }
  return undefined;
}

/** The chain of `delivery`, or the empty chain a first submission to it would extend. */
function chainIn(chains: readonly DeliveryChain[], delivery: Delivery): DeliveryChain {
  for (const chain of chains) {
    if (chain.delivery === delivery) return chain;
  }
  return { delivery, tip: null, base: null, changes: [] };
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
  chains: readonly DeliveryChain[],
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

export type SubmissionPreparation =
  | { readonly kind: "none" }
  | {
      readonly kind: "prepared";
      readonly publish: (change: Oid) => Promise<void>;
      readonly abandon: (change: Oid) => Promise<void>;
    };

export async function submit(
  session: Session,
  options: {
    readonly head: string;
    readonly body: ChangeBody;
    readonly kind: Change["kind"];
    readonly delivery: Delivery;
    readonly key?: string;
    /** Cross-session metadata published before the change and abandoned unless the change publishes. */
    readonly preparation: SubmissionPreparation;
    readonly actor?: Actor;
  },
): Promise<SubmitOutcome> {
  validateHeadName(options.head);
  validateDelivery(options.delivery);
  const tipName = inboxTipRef(options.head, options.delivery);
  const receiptName = options.key === undefined ? undefined : keyRef(options.key);

  if (receiptName !== undefined) {
    const existing = await session.refs.read(receiptName);
    if (existing !== null) return { kind: "duplicate", change: existing };
  }

  for (let attempt = 0; attempt < MAX_SUBMIT_ATTEMPTS; attempt += 1) {
    const tip = await session.refs.read(tipName);
    const baseChange: Change = {
      type: "change",
      kind: options.kind,
      delivery: options.delivery,
      previous: tip,
      body: options.body,
      at: Date.now(),
    };
    const keyed: Change =
      options.key === undefined ? baseChange : { ...baseChange, key: options.key };
    const change: Change =
      options.actor === undefined ? keyed : { ...keyed, author: options.actor };
    const oid = onlyOid(await session.objects.put([change]));
    let published = false;
    try {
      if (options.preparation.kind === "prepared") await options.preparation.publish(oid);
      const updates: RefUpdate[] = [{ name: tipName, from: tip, to: oid }];
      if (receiptName !== undefined) {
        updates.push({ name: receiptName, from: null, to: oid });
      }

      const updateOptions =
        options.actor === undefined
          ? { reason: "submit" }
          : { reason: "submit", actor: options.actor };
      const outcome = await session.refs.update(updates, updateOptions);
      if (outcome.ok) {
        published = true;
        return { kind: "queued", change: oid };
      }
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
    } finally {
      if (!published && options.preparation.kind === "prepared") {
        await options.preparation.abandon(oid);
      }
    }
  }

  throw new Error(`Queue submission did not settle after ${String(MAX_SUBMIT_ATTEMPTS)} attempts`);
}

async function cancelledSet(session: Session): Promise<ReadonlySet<Oid>> {
  const refs = await session.refs.list(CANCELLED_PREFIX);
  return new Set(refs.map((ref) => ref.name.slice(CANCELLED_PREFIX.length)));
}

export async function pendingIn(
  session: Session,
  options: { readonly head: string; readonly delivery: Delivery },
): Promise<readonly PendingChange[]> {
  validateDelivery(options.delivery);
  const [chain, cancelled] = await Promise.all([
    walkDelivery(session, options),
    cancelledSet(session),
  ]);
  return chain.changes.filter((item) => !cancelled.has(item.oid));
}

export async function pending(session: Session, head: string): Promise<readonly PendingChange[]> {
  const [chains, cancelled] = await Promise.all([
    walkDeliveries(session, head),
    cancelledSet(session),
  ]);
  return mergeByDelivery(
    chains.flatMap((chain) => chain.changes).filter((item) => !cancelled.has(item.oid)),
    { delivery: (item) => item.delivery, compare: comparePending },
  );
}

/**
 * Withdraw a pending change. The tombstone lands in one update with an
 * assertion on its delivery's inbox base, so a landing that races this cancel
 * makes the update fail and the outcome is re-read: a change is cancelled or
 * landed, never both.
 */
export async function cancel(
  session: Session,
  options: { readonly head: string; readonly change: Oid; readonly actor?: Actor },
): Promise<CancelOutcome> {
  validateHeadName(options.head);
  const name = cancelledRef(options.change);
  for (let attempt = 0; attempt < MAX_SUBMIT_ATTEMPTS; attempt += 1) {
    const chains = await walkDeliveries(session, options.head);
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
    const baseName = inboxBaseRef(options.head, located.chain.delivery);
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

/** Move or edit a pending change in one CAS. Unchanged prefixes retain their ids. */
export async function redeliver(
  session: Session,
  options: {
    readonly head: string;
    readonly change: Oid;
    readonly delivery: Delivery;
    readonly content?: UserMessage["content"];
    /** Omitted preserves position within a delivery; null moves to the end. */
    readonly before?: Oid | null;
    readonly actor?: Actor;
  },
): Promise<RedeliverOutcome> {
  validateHeadName(options.head);
  validateDelivery(options.delivery);
  const tombstoneName = cancelledRef(options.change);
  for (let attempt = 0; attempt < MAX_SUBMIT_ATTEMPTS; attempt += 1) {
    const chains = await walkDeliveries(session, options.head);
    const located = locate(chains, options.change);
    if (located === undefined) {
      return (await wasLanded(session, chains, options.change))
        ? { kind: "landed" }
        : { kind: "not_found" };
    }
    if ((await session.refs.read(tombstoneName)) !== null) return { kind: "not_found" };
    const target = chainIn(chains, options.delivery);
    const cancelled = await cancelledSet(session);
    const original = target.changes.filter((item) => !cancelled.has(item.oid));
    const sourceIndex = original.findIndex((item) => item.oid === options.change);
    const reordered = original.filter((item) => item.oid !== options.change);
    const index =
      options.before === undefined
        ? sourceIndex === -1
          ? reordered.length
          : sourceIndex
        : options.before === null
          ? reordered.length
          : options.before === options.change
            ? sourceIndex
            : reordered.findIndex((item) => item.oid === options.before);
    if (index < 0) return { kind: "not_found" };
    if (
      options.content === undefined &&
      index === sourceIndex &&
      target.delivery === located.chain.delivery
    )
      return { kind: "unchanged" };
    const body = located.item.change.body;
    if (options.content !== undefined && (body.kind !== "message" || body.message.role !== "user"))
      return { kind: "not_found" };
    reordered.splice(index, 0, located.item);
    const start = Math.min(sourceIndex === -1 ? original.length : sourceIndex, index);
    const replaced = new Set([options.change, ...original.slice(start).map((item) => item.oid)]);
    const tombstone = onlyOid(
      await session.objects.put([{ kind: "blob", value: { at: Date.now() } }]),
    );
    let tip = target.tip;
    let copied = options.change;
    for (const item of reordered.slice(start)) {
      const change = item.change;
      const nextBody =
        item.oid === options.change &&
        options.content !== undefined &&
        body.kind === "message" &&
        body.message.role === "user"
          ? { ...body, message: { ...body.message, content: options.content } }
          : change.body;
      const copy: Change = {
        ...change,
        delivery: options.delivery,
        previous: tip,
        supersedes: item.oid,
        body: nextBody,
      };
      tip = onlyOid(await session.objects.put([copy]));
      if (item.oid === options.change) copied = tip;
    }
    const sourceBaseName = inboxBaseRef(options.head, located.chain.delivery);
    const targetTipName = inboxTipRef(options.head, options.delivery);
    const updateOptions =
      options.actor === undefined
        ? { reason: "redeliver" }
        : { reason: "redeliver", actor: options.actor };
    const outcome = await session.refs.update(
      [
        ...[...replaced].map((oid) => ({ name: cancelledRef(oid), from: null, to: tombstone })),
        {
          name: sourceBaseName,
          from: located.chain.base,
          to: located.chain.base,
        },
        ...(target.delivery === located.chain.delivery
          ? []
          : [
              {
                name: inboxBaseRef(options.head, target.delivery),
                from: target.base,
                to: target.base,
              },
            ]),
        { name: targetTipName, from: target.tip, to: tip },
      ],
      updateOptions,
    );
    if (outcome.ok) return { kind: "redelivered", change: copied };
    if (outcome.reason === "fenced") throw new Error("Unexpected fenced queue redelivery");
    if (
      [...replaced].some((oid) => outcome.name === cancelledRef(oid)) ||
      outcome.name === sourceBaseName ||
      outcome.name === inboxBaseRef(options.head, target.delivery) ||
      outcome.name === targetTipName
    ) {
      continue;
    }
    throw new Error(`Unexpected queue redelivery conflict on ${outcome.name}`);
  }
  throw new Error(`Queue redelivery did not settle after ${String(MAX_SUBMIT_ATTEMPTS)} attempts`);
}

/** The oldest live change in the first delivery with one. */
export async function nextToLand(
  session: Session,
  options: { readonly head: string; readonly deliveries: readonly Delivery[] },
): Promise<NextChange | undefined> {
  const cancelled = await cancelledSet(session);
  for (const delivery of options.deliveries) {
    const chain = await walkDelivery(session, { head: options.head, delivery });
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
