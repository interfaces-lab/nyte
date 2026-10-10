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
import { summarize, summaryUpdates } from "./branch-summary.ts";
import { objectId } from "./content.ts";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import type { Receipt } from "./receipt.ts";
import { isMoveOutcome, typedReceipt } from "./receipt-handles.ts";
import { settleReceipt } from "./receipts.ts";
import type { CommitRecord } from "./records.ts";
import { headRef } from "./refs.ts";
import { fenceUpdates, stopRun } from "./runs.ts";
import {
  EMPTY_REVISION,
  STALE,
  attempt,
  commit,
  expectOf,
  guardHead,
  objectOf,
  pathOf,
  positionOf,
  readReceipt,
  readTip,
  requireSession,
  staleHead,
  withFold,
  writeReceipt,
} from "./session-state.ts";
import type { Tip } from "./session-state.ts";

/** Returns where a move lands, what it hands back, and the commits it leaves behind. */
interface Plan {
  readonly landing: CommitId | null;
  readonly handback: UserContent | null;
  readonly abandoned: readonly CommitId[];
}

/** Returns a move that only its branch summary still decides: the tip it saw, its plan and the instructions. */
interface Summarizing {
  readonly tip: Tip;
  readonly plan: Plan;
  readonly instructions: string | null;
}

/** Moves a head to a position as a durable command and returns its receipt: guards, the stop fence and the move are decided before it returns, a fenced run's head move in the same set; only a branch summary settles later, as moved, `stale` or `summary-failed`. `id` is the receipt's id (minted when absent): a move whose id the session already holds with the same digest replays that receipt and moves nothing, another digest throws `invalid` (§40e). */
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

  const known = await readReceipt(kernel, session, id);

  if (known !== null) {
    if (known.record.kind !== "move" || known.record.digest !== digest)
      throw new SdkError("invalid", `Receipt ${id} was used for another command.`);

    return typedReceipt(kernel, session, id, isMoveOutcome);
  }

  const decided = await decide(kernel, session, head, position, options ?? {});

  if ("kind" in decided) {
    await writeReceipt(kernel, session, { id, kind: "move", digest, outcome: decided });

    return typedReceipt(kernel, session, id, isMoveOutcome);
  }

  await writeReceipt(kernel, session, { id, kind: "move", digest, outcome: null });

  void summarized(kernel, session, head, decided)
    .catch((error: unknown): MoveOutcome => ({
      kind: "summary-failed",
      reason: error instanceof Error ? error.message : String(error),
    }))
    .then((outcome) => settleReceipt(kernel, session, id, outcome))
    .catch(() => undefined);

  return typedReceipt(kernel, session, id, isMoveOutcome);
}

async function decide(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  position: Position,
  options: MoveOptions,
): Promise<MoveOutcome | Summarizing> {
  const checked = await guardHead(
    kernel,
    session,
    head,
    options.expect,
    options.running ?? "refuse",
  );

  if ("kind" in checked) return checked;

  if (
    position.kind === "commit" &&
    !(await withFold(kernel, session, (state) => state.commits.has(position.id)))
  )
    return { kind: "missing-target" };

  const abandoned = options.abandoned;

  if (typeof abandoned !== "object") return keep(kernel, session, head, position, checked.run);

  if (checked.run !== null) await stopRun(kernel, session, checked.run);
  const tip = await readTip(kernel, session, head);
  const plan = await withFold(kernel, session, (state) => planOf(state.commits, tip.id, position));

  if (plan === null) return { kind: "missing-target" };

  if (plan.abandoned.length === 0) return keep(kernel, session, head, position, null);

  return { tip, plan, instructions: abandoned.summarize.instructions ?? null };
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

async function keep(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  position: Position,
  run: RunId | null,
): Promise<MoveOutcome> {
  const kept = await attempt<{ readonly outcome: MoveOutcome; readonly fenced: boolean }>(
    `Moving ${head}`,
    async () => {
      const fence = run === null ? null : await fenceUpdates(kernel, session, run);
      const tip = await readTip(kernel, session, head);

      const plan = await withFold(kernel, session, (state) =>
        planOf(state.commits, tip.id, position),
      );

      if (plan === null) return { outcome: { kind: "missing-target" }, fenced: false };

      const outcome = await commit(kernel, [
        ...(fence?.updates ?? []),
        {
          name: headRef(session, head),
          target: plan.landing === null ? null : objectOf(plan.landing),
          expect: expectOf(tip.ref),
          event: { head, kind: "head", from: tip.id, to: plan.landing, reason: "moved" },
        },
      ]);

      if (outcome.kind === "stale")
        return outcome.name === headRef(session, head)
          ? { outcome: await staleHead(kernel, session, head), fenced: false }
          : STALE;

      return {
        outcome: {
          kind: "moved",
          revision:
            plan.landing === null ? EMPTY_REVISION : (outcome.revisions.at(-1) ?? EMPTY_REVISION),
          position: positionOf(plan.landing),
          summary: null,
          handback: plan.handback,
        },
        fenced: fence !== null,
      };
    },
  );

  if (run !== null && kept.fenced) {
    kernel.runs.markStopping(run);
    kernel.runs.abort(run);
    kernel.wakes.notify(session, head);
  }

  return kept.outcome;
}

async function summarized(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  pending: Summarizing,
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
