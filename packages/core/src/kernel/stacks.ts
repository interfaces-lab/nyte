/**
 * Branch heads and their optional stack relationships. A head is a name: the
 * kernel privileges none, so which head a client must keep, and which it
 * addresses by default, is the client's rule.
 */
import { isAncestor } from "./graph.ts";
import {
  HEAD_PREFIX,
  STACK_PREFIX,
  headRef,
  isHeadName,
  inboxPrefix,
  runRef,
  stackRef,
} from "./names.ts";
import type { Actor, Oid, RefName, RefUpdate, Stack } from "./model.ts";
import type { Session } from "./store.ts";

export interface ListedHead {
  readonly head: string;
  readonly tip: Oid | null;
  readonly stack?: Stack;
}

export type CreateHeadOutcome =
  | { readonly kind: "created"; readonly tip: Oid | null }
  | { readonly kind: "exists" };

export type MoveHeadOutcome =
  | { readonly kind: "moved"; readonly from: Oid | null }
  | { readonly kind: "moved_since"; readonly tip: Oid | null }
  | { readonly kind: "not_found" };

export type DeleteHeadOutcome =
  | { readonly kind: "deleted" }
  | { readonly kind: "not_found" }
  | { readonly kind: "busy" };

export type StackStatus =
  | { readonly kind: "no_stack" }
  | { readonly kind: "current"; readonly base: Oid | null; readonly parentTip: Oid | null }
  | { readonly kind: "stale"; readonly base: Oid | null; readonly parentTip: Oid | null };

export type AdvanceBaseOutcome =
  | { readonly kind: "advanced" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "diverged" };

export type FastForwardOutcome =
  | { readonly kind: "merged"; readonly tip: Oid }
  | { readonly kind: "stale" }
  | { readonly kind: "empty" }
  | { readonly kind: "no_stack" };

type StoredStack = {
  readonly oid: Oid;
  readonly stack: Stack;
  readonly parentTip: Oid | null;
};

function validateHead(head: string): void {
  if (!isHeadName(head)) throw new TypeError(`Invalid head name: ${head}`);
}

function headFromRef(name: RefName, prefix: string): string {
  const head = name.slice(prefix.length);

  if (!isHeadName(head)) throw new Error(`Invalid stored head ref: ${name}`);

  return head;
}

async function readStack(session: Session, oid: Oid): Promise<Stack> {
  const object = await session.objects.get(oid);

  if (object === undefined || object.kind !== "stack") {
    throw new Error(`Corrupt stack ref at ${oid}: missing or non-stack object`);
  }

  return object;
}

async function readStoredStack(session: Session, head: string): Promise<StoredStack | undefined> {
  const oid = await session.refs.read(stackRef(head));

  if (oid === null) return undefined;
  const stack = await readStack(session, oid);
  const parentTip = await session.refs.read(headRef(stack.parent));

  return { oid, stack, parentTip };
}

async function putStack(session: Session, stack: Stack): Promise<Oid> {
  const oids = await session.objects.put([stack]);
  const oid = oids[0];

  if (oid === undefined) throw new Error("Store did not return an oid for a stack object");

  return oid;
}

function compareHeads(left: ListedHead, right: ListedHead): number {
  if (left.head < right.head) return -1;

  if (left.head > right.head) return 1;

  return 0;
}

/**
 * List every head a head or stack ref names, in name order. An unborn head
 * with no stack has no ref yet, so it is not listed until something lands.
 */
export async function listHeads(session: Session): Promise<ListedHead[]> {
  const [headRefs, stackRefs] = await Promise.all([
    session.refs.list(HEAD_PREFIX),
    session.refs.list(STACK_PREFIX),
  ]);

  const heads = new Map<string, ListedHead>();

  for (const ref of headRefs) {
    const head = headFromRef(ref.name, HEAD_PREFIX);
    heads.set(head, { head, tip: ref.oid });
  }

  await Promise.all(
    stackRefs.map(async (ref) => {
      const head = headFromRef(ref.name, STACK_PREFIX);
      const stack = await readStack(session, ref.oid);
      const listed = heads.get(head);
      heads.set(head, { head, tip: listed?.tip ?? null, stack });
    }),
  );

  return [...heads.values()].sort(compareHeads);
}

/** Create a head from a commit or cut it from a parent head. */
export async function createHead(
  session: Session,
  options: {
    readonly head: string;
    readonly from: { readonly head: string } | { readonly commit: Oid | null };
    readonly actor?: Actor;
  },
): Promise<CreateHeadOutcome> {
  validateHead(options.head);

  if ("head" in options.from) validateHead(options.from.head);

  const targetHeadRef = headRef(options.head);
  const targetStackRef = stackRef(options.head);

  const [currentTip, currentStack] = await Promise.all([
    session.refs.read(targetHeadRef),
    session.refs.read(targetStackRef),
  ]);

  if (currentTip !== null || currentStack !== null) return { kind: "exists" };

  let tip: Oid | null;
  let stack: Stack | undefined;

  if ("head" in options.from) {
    // A parent is a name. An unborn parent gives a stack with no base; whether
    // an unlisted name is a mistake is the caller's call, not the kernel's.
    const parent = options.from.head;
    tip = await session.refs.read(headRef(parent));
    stack = { kind: "stack", parent, base: tip };
  } else {
    tip = options.from.commit;
  }

  if (tip === null && stack === undefined) {
    throw new TypeError("An unborn head requires a stack parent");
  }

  const updates: RefUpdate[] = [];

  if (tip !== null) updates.push({ name: targetHeadRef, from: null, to: tip });

  if (stack !== undefined) {
    const stackOid = await putStack(session, stack);
    updates.push({ name: targetStackRef, from: null, to: stackOid });
  }

  const outcome = await session.refs.update(updates, {
    reason: "create",
    actor: options.actor,
  });

  if (outcome.ok) return { kind: "created", tip };

  if (outcome.reason === "conflict") return { kind: "exists" };
  throw new Error("Participant create was unexpectedly fenced");
}

/** Re-point a head with an optional caller-supplied compare value. */
export async function moveHead(
  session: Session,
  options: {
    readonly head: string;
    readonly to: Oid | null;
    readonly expect?: Oid | null;
    readonly actor?: Actor;
  },
): Promise<MoveHeadOutcome> {
  validateHead(options.head);
  const target = headRef(options.head);
  const current = await session.refs.read(target);

  if (options.expect !== undefined && options.expect !== current) {
    return { kind: "moved_since", tip: current };
  }

  if (options.to !== null) {
    const object = await session.objects.get(options.to);

    if (object === undefined || object.kind !== "commit") return { kind: "not_found" };
  }

  const outcome = await session.refs.update([{ name: target, from: current, to: options.to }], {
    reason: "move",
    actor: options.actor,
  });

  if (outcome.ok) return { kind: "moved", from: current };

  if (outcome.reason === "conflict") return { kind: "moved_since", tip: outcome.actual };
  throw new Error("Participant move was unexpectedly fenced");
}

/**
 * Delete every mutable ref a head owns in one compare-and-swap: its tip, stack,
 * both inbox deliveries' refs, and its run. Any head may go; a runner holding the
 * head makes this `busy`.
 */
export async function deleteHead(
  session: Session,
  options: { readonly head: string; readonly actor?: Actor },
): Promise<DeleteHeadOutcome> {
  validateHead(options.head);

  for (;;) {
    const inboxRefs = await session.refs.list(inboxPrefix(options.head));

    const names = [
      headRef(options.head),
      stackRef(options.head),
      ...inboxRefs.map((ref) => ref.name),
      runRef(options.head),
    ];

    const current = await Promise.all(names.map((name) => session.refs.read(name)));

    if (current[0] === null && current[1] === null) return { kind: "not_found" };

    if ((await session.leases.read(names[0])) !== undefined) return { kind: "busy" };

    const updates: RefUpdate[] = names.map((name, index) => ({
      name,
      from: current[index] ?? null,
      to: null,
    }));

    const outcome = await session.refs.update(updates, {
      reason: "delete",
      actor: options.actor,
    });

    if (outcome.ok) return { kind: "deleted" };

    if (outcome.reason === "fenced") {
      throw new Error("Participant delete was unexpectedly fenced");
    }
  }
}

/** Report whether a stacked head's recorded base matches its parent's tip. */
export async function stackStatus(session: Session, head: string): Promise<StackStatus> {
  validateHead(head);
  const stored = await readStoredStack(session, head);

  if (stored === undefined) return { kind: "no_stack" };
  const status = { base: stored.stack.base, parentTip: stored.parentTip };

  return status.base === status.parentTip
    ? { kind: "current", ...status }
    : { kind: "stale", ...status };
}

/** Advance a stale base when its old base remains on the parent's history. */
export async function advanceBase(
  session: Session,
  options: { readonly head: string },
): Promise<AdvanceBaseOutcome> {
  validateHead(options.head);

  for (;;) {
    const stored = await readStoredStack(session, options.head);

    if (stored === undefined || stored.stack.base === stored.parentTip) {
      return { kind: "unchanged" };
    }

    if (
      !(await isAncestor(session.objects, {
        ancestor: stored.stack.base,
        descendant: stored.parentTip,
      }))
    ) {
      return { kind: "diverged" };
    }

    const next: Stack = {
      kind: "stack",
      parent: stored.stack.parent,
      base: stored.parentTip,
    };

    const nextOid = await putStack(session, next);

    const outcome = await session.refs.update(
      [{ name: stackRef(options.head), from: stored.oid, to: nextOid }],
      { reason: "restack" },
    );

    if (outcome.ok) return { kind: "advanced" };

    if (outcome.reason === "fenced") {
      throw new Error("Participant restack was unexpectedly fenced");
    }
  }
}

/** Fast-forward a stacked child onto its parent and advance the child's base atomically. */
export async function fastForward(
  session: Session,
  options: { readonly head: string; readonly actor?: Actor },
): Promise<FastForwardOutcome> {
  validateHead(options.head);

  for (;;) {
    const [stored, childTip] = await Promise.all([
      readStoredStack(session, options.head),
      session.refs.read(headRef(options.head)),
    ]);

    if (stored === undefined) return { kind: "no_stack" };

    if (stored.stack.base !== stored.parentTip) return { kind: "stale" };

    if (childTip === null || childTip === stored.stack.base) return { kind: "empty" };

    const next: Stack = {
      kind: "stack",
      parent: stored.stack.parent,
      base: childTip,
    };

    const nextOid = await putStack(session, next);

    const outcome = await session.refs.update(
      [
        { name: headRef(stored.stack.parent), from: stored.stack.base, to: childTip },
        { name: stackRef(options.head), from: stored.oid, to: nextOid },
      ],
      { reason: "merge", actor: options.actor },
    );

    if (outcome.ok) return { kind: "merged", tip: childTip };

    if (outcome.reason === "fenced") {
      throw new Error("Participant merge was unexpectedly fenced");
    }
  }
}
