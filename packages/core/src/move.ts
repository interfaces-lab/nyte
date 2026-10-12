import { asId } from "@nyte-ai/schema";
import type {
  CommitId,
  HeadName,
  MoveOptions,
  MoveOutcome,
  Position,
  ReceiptId,
  RunId,
  SessionId,
  UserContent,
} from "@nyte-ai/schema";
import { guard } from "./admission.ts";
import { summarize, summaryUpdates } from "./branch-summary.ts";
import { objectId } from "./content.ts";
import type { Kernel } from "./kernel.ts";
import type { Receipt } from "./receipt.ts";
import { isMoveOutcome, known, reserve, typedReceipt } from "./receipt-handles.ts";
import { settleReceipt } from "./receipts.ts";
import type { CommitRecord } from "./records.ts";
import { headRef, inboxRef, receiptRef } from "./refs.ts";
import { abortHere, fence, stopRun } from "./runs.ts";
import {
  EMPTY_REVISION,
  STALE,
  attempt,
  commit,
  expectOf,
  objectOf,
  pathOf,
  positionOf,
  put,
  requireSession,
  staleHead,
  withFold,
} from "./session-state.ts";
import type { MoveFailure, Tip } from "./session-state.ts";

/** Returns where a move lands, what it hands back, and the commits it leaves behind. */
interface Plan {
  readonly landing: CommitId | null;
  readonly handback: UserContent | null;
  readonly abandoned: readonly CommitId[];
}

/** Returns what a move decided: a guard failure, a branch summary still to write, a move written with its receipt, or the receipt another request with the same id wrote first. */
type Decided =
  | { readonly kind: "failed"; readonly outcome: MoveFailure }
  | {
      readonly kind: "summarize";
      readonly tip: Tip;
      readonly plan: Plan;
      readonly run: RunId | null;
      readonly instructions: string | null;
    }
  | { readonly kind: "moved"; readonly outcome: MoveOutcome; readonly stopped: RunId | null }
  | { readonly kind: "replayed" };

/** Moves a head to a position as a durable command and returns its receipt (§40e). The guards, the stop fence, the head move and the pending receipt land in one set guarded by what the guard read, so a duplicate request with the same id replays the receipt and moves nothing; only a branch summary settles later. */
export async function move(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  position: Position,
  options?: MoveOptions & { readonly id?: ReceiptId },
): Promise<Receipt<MoveOutcome>> {
  await requireSession(kernel, session);
  const id = options?.id ?? asId<"receipt">(crypto.randomUUID());

  const digest = await objectId({
    head,
    position,
    running: options?.running ?? null,
    abandoned: options?.abandoned ?? null,
    expect: options?.expect ?? null,
  });

  const receipt = typedReceipt(kernel, session, id, isMoveOutcome);

  if (await known(kernel, session, id, "move", digest)) return receipt;
  const decided = await decide(kernel, session, head, position, options ?? {}, id, digest);

  switch (decided.kind) {
    case "replayed":
      return receipt;

    case "failed":
      if (!(await reserve(kernel, session, { id, kind: "move", digest, outcome: decided.outcome })))
        await known(kernel, session, id, "move", digest);

      return receipt;

    case "moved":
      if (decided.stopped !== null) {
        abortHere(kernel, decided.stopped);
        kernel.wakes.notify(session, head);
      }

      await settleReceipt(kernel, session, id, decided.outcome);

      return receipt;

    case "summarize":
      if (!(await reserve(kernel, session, { id, kind: "move", digest, outcome: null }))) {
        await known(kernel, session, id, "move", digest);

        return receipt;
      }

      if (decided.run !== null) await stopRun(kernel, session, decided.run);

      void summarized(kernel, session, head, decided)
        .catch((error: unknown): MoveOutcome => ({
          kind: "summary-failed",
          reason: error instanceof Error ? error.message : String(error),
        }))
        .then((outcome) => settleReceipt(kernel, session, id, outcome))
        .catch(() => undefined);

      return receipt;
  }
}

async function decide(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  position: Position,
  options: MoveOptions,
  id: ReceiptId,
  digest: string,
): Promise<Decided> {
  return attempt<Decided>(`Moving ${head}`, async () => {
    const checked = await guard(kernel, session, head, options.expect, options.running ?? "refuse");

    if ("kind" in checked) return { kind: "failed", outcome: checked };

    const plan = await withFold(kernel, session, (state) =>
      planOf(state.commits, checked.tip.id, position),
    );

    if (plan === null) return { kind: "failed", outcome: { kind: "missing-target" } };
    const abandoned = options.abandoned;

    if (typeof abandoned === "object" && plan.abandoned.length > 0)
      return {
        kind: "summarize",
        tip: checked.tip,
        plan,
        run: checked.run,
        instructions: abandoned.summarize.instructions ?? null,
      };

    const fenced = checked.run === null ? null : await fence(kernel, session, checked.run);

    const outcome = await commit(kernel, [
      ...(fenced?.kind === "live" ? fenced.updates : []),
      {
        name: inboxRef(session, head),
        target: checked.inbox.ref?.target ?? null,
        expect: expectOf(checked.inbox.ref),
      },
      {
        name: receiptRef(session, id),
        target: await put(kernel, "receipt", { id, kind: "move", digest, outcome: null }),
        expect: "absent",
      },
      {
        name: headRef(session, head),
        target: plan.landing === null ? null : objectOf(plan.landing),
        expect: expectOf(checked.tip.ref),
        event: { head, kind: "head", from: checked.tip.id, to: plan.landing, reason: "moved" },
      },
    ]);

    if (outcome.kind === "stale")
      return outcome.name === receiptRef(session, id) &&
        (await known(kernel, session, id, "move", digest))
        ? { kind: "replayed" }
        : STALE;

    return {
      kind: "moved",
      stopped: fenced === null || fenced.kind === "ended" ? null : checked.run,
      outcome: {
        kind: "moved",
        revision:
          plan.landing === null ? EMPTY_REVISION : (outcome.revisions.at(-1) ?? EMPTY_REVISION),
        position: positionOf(plan.landing),
        summary: null,
        handback: plan.handback,
      },
    };
  });
}

function planOf(
  commits: ReadonlyMap<CommitId, CommitRecord>,
  tip: CommitId | null,
  position: Position,
): Plan | null {
  const plan = (landing: CommitId | null, handback: UserContent | null): Plan => {
    const kept = new Set(pathOf(commits, landing));

    return { landing, handback, abandoned: pathOf(commits, tip).filter((id) => !kept.has(id)) };
  };

  if (position.kind === "start") return plan(null, null);
  const target = commits.get(position.id);

  if (target === undefined) return null;

  return target.body.kind === "user"
    ? plan(target.parent, target.body.content)
    : plan(position.id, null);
}

async function summarized(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  pending: Extract<Decided, { readonly kind: "summarize" }>,
): Promise<MoveOutcome> {
  const { tip, plan } = pending;

  const summary = await summarize(kernel, {
    session,
    head,
    commits: plan.abandoned,
    instructions: pending.instructions,
    signal: new AbortController().signal,
  });

  if (summary.kind === "failed") return { kind: "summary-failed", reason: summary.reason };

  const written = await summaryUpdates(kernel, {
    session,
    head,
    tip,
    landing: plan.landing,
    abandoned: plan.abandoned,
    markdown: summary.markdown,
  });

  const outcome = await commit(kernel, written.updates);

  if (outcome.kind === "stale") return staleHead(kernel, session, head);

  return {
    kind: "moved",
    revision: outcome.revisions.at(-1) ?? EMPTY_REVISION,
    position: { kind: "commit", id: written.commit },
    summary: asId<"message">(written.part),
    handback: plan.handback,
  };
}
