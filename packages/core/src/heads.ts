import type {
  CreateHeadOutcome,
  HeadInfo,
  HeadName,
  MergeOutcome,
  Position,
  RefUpdate,
  RemoveHeadOutcome,
  Revision,
  SessionId,
} from "@nyte-ai/schema";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import type { SessionRecord } from "./records.ts";
import { headRef, sessionRef } from "./refs.ts";
import {
  EMPTY_REVISION,
  MAIN,
  STALE,
  attempt,
  commit,
  expectOf,
  liveRun,
  objectOf,
  positionOf,
  put,
  readCommit,
  readTip,
  requireSession,
  sameRevision,
  sessionEvent,
  tipOf,
} from "./session-state.ts";

/** Creates a head at a position, default its stack parent's tip, and publishes `head created` with the updated session record. */
export async function createHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  input?: { readonly from?: Position },
): Promise<CreateHeadOutcome> {
  return attempt<CreateHeadOutcome>(`Creating head ${head}`, async () => {
    const found = await requireSession(kernel, session);

    if (found.record.heads.some((entry) => entry.name === head)) return { kind: "exists" };
    const main = await readTip(kernel, session, MAIN);
    const from = input?.from ?? positionOf(main.id);
    const source = tipOf(from);

    if (source !== null && (await readCommit(kernel, source)) === null)
      return { kind: "missing-source" };
    const at = Date.now();

    const record: SessionRecord = {
      ...found.record,
      heads: [
        ...found.record.heads,
        {
          name: head,
          stack: { parent: MAIN, base: from, stale: false },
          selected: null,
          lastRun: null,
        },
      ],
    };

    const rows = new Map<HeadName, Partial<HeadInfo>>([[head, { tip: from }]]);

    const created: readonly RefUpdate[] =
      source === null
        ? []
        : [
            {
              name: headRef(session, head),
              target: objectOf(source),
              expect: "absent",
              event: { head, kind: "head", from: null, to: source, reason: "created" },
            },
          ];

    const outcome = await commit(kernel, [
      {
        name: sessionRef(session),
        target: await put(kernel, "session", record, at),
        expect: found.ref.revision,
        event: await sessionEvent(kernel, record, rows),
      },
      ...created,
    ]);

    return outcome.kind === "set" ? { kind: "created", basedOn: from } : STALE;
  });
}

/** Fast-forwards a head's stack parent to its tip and publishes `head merged` with the updated session record. */
export async function mergeHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  options?: { readonly expect?: Revision },
): Promise<MergeOutcome> {
  const found = await requireSession(kernel, session);
  const entry = found.record.heads.find((current) => current.name === head);

  if (entry === undefined) throw new SdkError("unknown", `Session ${session} has no head ${head}.`);
  const stack = entry.stack;

  if (head === MAIN || stack === null) return { kind: "is-main" };

  const [own, parent] = await Promise.all([
    readTip(kernel, session, head),
    readTip(kernel, session, stack.parent),
  ]);

  if (options?.expect !== undefined && !sameRevision(options.expect, own.ref))
    return { kind: "stale", revision: own.ref?.revision ?? EMPTY_REVISION };

  if (parent.id !== tipOf(stack.base)) return { kind: "diverged", base: stack.base };
  const tip = positionOf(own.id);

  const record: SessionRecord = {
    ...found.record,
    heads: found.record.heads.map((current) =>
      current.name === head
        ? { ...current, stack: { ...stack, base: tip, stale: false } }
        : current,
    ),
  };

  const outcome = await commit(kernel, [
    {
      name: headRef(session, stack.parent),
      target: own.ref?.target ?? null,
      expect: expectOf(parent.ref),
      event: {
        head: stack.parent,
        kind: "head",
        from: parent.id,
        to: own.id,
        reason: "merged",
      },
    },
    {
      name: sessionRef(session),
      target: await put(kernel, "session", record),
      expect: found.ref.revision,
      event: await sessionEvent(kernel, record),
    },
  ]);

  if (outcome.kind === "stale")
    return {
      kind: "stale",
      revision: (await readTip(kernel, session, head)).ref?.revision ?? EMPTY_REVISION,
    };

  return { kind: "merged", revision: own.ref === null ? EMPTY_REVISION : outcome.revisions[0] };
}

/** Deletes a head's ref and publishes `head removed` with the updated session record; its commits stay reachable from the others. */
export async function removeHead(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  options?: { readonly expect?: Revision },
): Promise<RemoveHeadOutcome> {
  if (head === MAIN) return { kind: "is-main" };

  return attempt<RemoveHeadOutcome>(`Removing head ${head}`, async () => {
    const found = await requireSession(kernel, session);

    if (!found.record.heads.some((entry) => entry.name === head)) return { kind: "missing" };
    const run = await liveRun(kernel, session, head);

    if (run !== null) return { kind: "busy", run: run.record.view.id };
    const tip = await readTip(kernel, session, head);

    if (options?.expect !== undefined && !sameRevision(options.expect, tip.ref))
      throw new SdkError("stale", `Head ${head} moved since ${options.expect}.`);

    const record: SessionRecord = {
      ...found.record,
      heads: found.record.heads.filter((entry) => entry.name !== head),
    };

    const removed: readonly RefUpdate[] =
      tip.ref === null
        ? []
        : [
            {
              name: headRef(session, head),
              target: null,
              expect: tip.ref.revision,
              event: {
                head,
                kind: "head",
                from: tip.id,
                to: null,
                reason: "removed",
              },
            },
          ];

    const outcome = await commit(kernel, [
      ...removed,
      {
        name: sessionRef(session),
        target: await put(kernel, "session", record),
        expect: found.ref.revision,
        event: await sessionEvent(kernel, record),
      },
    ]);

    return outcome.kind === "set" ? { kind: "removed" } : STALE;
  });
}
