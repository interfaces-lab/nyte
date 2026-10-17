import { asId, SdkError } from "@nyte-ai/schema";
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
import type { Kernel } from "../contract/kernel.ts";
import type { CommitRecord } from "../contract/records.ts";
import type { Receipt } from "../contract/session.ts";
import { commit } from "../fold/commit.ts";
import { withFold } from "../fold/reads.ts";
import { headRef, inboxRef, receiptRef } from "../store/refs.ts";
import {
  attempt,
  createPosition,
  EMPTY_REVISION,
  guard,
  MAIN,
  put,
  readReceipt,
  readRefExpectation,
  readTip,
  requireSession,
  STALE,
  toCommitObjectId,
  walkCommitPath,
} from "../store/session.ts";
import type { MoveFailure, Tip } from "../store/session.ts";
import { objectId } from "../util/content.ts";
import { holdSummary, summarizedMove, summaryHeld } from "./branch-summary.ts";
import { fence, finishFence } from "./fence.ts";
import { known, reserve, settleReceipt, typedReceipt } from "./receipts.ts";

const EMPTY_CHAT =
  "Main can't move before its first message with nothing queued: the chat would be empty. Send a replacement for that message instead.";

interface Plan {
  readonly landing: CommitId | null;
  readonly handback: UserContent | null;
  readonly abandoned: readonly CommitId[];
}

type Decided =
  | { readonly kind: "failed"; readonly outcome: MoveFailure }
  | {
      readonly kind: "summarize";
      readonly tip: Tip;
      readonly plan: Plan;
      readonly instructions: string | null;
    }
  | { readonly kind: "moved"; readonly outcome: MoveOutcome; readonly stopped: RunId | null }
  | { readonly kind: "replayed" };

export async function move(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  position: Position,
  options?: MoveOptions & { readonly id?: ReceiptId },
): Promise<Receipt<MoveOutcome>> {
  await requireSession(kernel.store, session);
  const id = options?.id ?? asId<"receipt">(crypto.randomUUID());

  const digest = await objectId({
    head,
    position,
    running: options?.running ?? null,
    abandoned: options?.abandoned ?? null,
    expect: options?.expect ?? null,
  });

  const receipt = typedReceipt(kernel, session, id, (record) => {
    if (record.kind !== "move") throw new SdkError("internal", `Receipt ${id} is not a move.`);

    return record.outcome;
  });

  if (await known(kernel.store, session, id, "move", digest)) {
    await recover(kernel, session, id);

    return receipt;
  }

  const decided = await decide(kernel, session, head, position, options ?? {}, id, digest);

  switch (decided.kind) {
    case "replayed":
      return receipt;

    case "failed":
      if (!(await reserve(kernel, session, { id, kind: "move", digest, outcome: decided.outcome })))
        await known(kernel.store, session, id, "move", digest);

      return receipt;

    case "moved":
      if (decided.stopped !== null) {
        await finishFence(kernel, session, decided.stopped);
        kernel.wakes.notify(session, head);
      }

      await settleReceipt(kernel, session, id, { kind: "move", outcome: decided.outcome });

      return receipt;

    case "summarize": {
      const release = holdSummary(kernel, session, id);

      if (!(await reserve(kernel, session, { id, kind: "move", digest, outcome: null }))) {
        release();
        await known(kernel.store, session, id, "move", digest);

        return receipt;
      }

      void summarizedMove(kernel, {
        session,
        head,
        receipt: id,
        tip: decided.tip,
        landing: decided.plan.landing,
        instructions: decided.instructions,
        running: options?.running ?? "refuse",
        updates: async ({ inbox, receipt: pending, commit }) => [
          {
            name: inboxRef(session, head),
            target: inbox.ref?.target ?? null,
            expect: readRefExpectation(inbox.ref),
          },
          {
            name: pending.ref.name,
            target: await put(kernel.store, "receipt", {
              ...pending.record,
              move: { head, position: { kind: "commit", id: commit } },
            }),
            expect: pending.ref.revision,
          },
        ],
      })
        .then(async (summarized): Promise<MoveOutcome | null> => {
          if (summarized.kind !== "moved")
            return summarized.kind === "failed" ? summarized.outcome : null;

          if (summarized.stopped !== null) {
            await finishFence(kernel, session, summarized.stopped);
            kernel.wakes.notify(session, head);
          }

          return {
            kind: "moved",
            revision: summarized.revision,
            position: { kind: "commit", id: summarized.commit },
            summary: asId<"message">(summarized.part),
            handback: decided.plan.handback,
          };
        })
        .catch((error: unknown): MoveOutcome => ({
          kind: "summary-failed",
          reason: error instanceof Error ? error.message : String(error),
        }))
        .then((outcome) =>
          outcome === null
            ? undefined
            : settleReceipt(kernel, session, id, { kind: "move", outcome }),
        )
        .catch(() => undefined)
        .finally(release);

      return receipt;
    }
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
    const checked = await guard(
      kernel.store,
      session,
      head,
      options.expect,
      options.running ?? "refuse",
    );

    if ("kind" in checked) return { kind: "failed", outcome: checked };

    const plan = await withFold(kernel, session, (state) =>
      planHistoryMove(state.commits, checked.tip.id, position),
    );

    if (plan === null) return { kind: "failed", outcome: { kind: "missing-target" } };

    if (head === MAIN && plan.landing === null && checked.inbox.messages.length === 0)
      throw new SdkError("invalid", EMPTY_CHAT);
    const abandoned = options.abandoned;

    if (typeof abandoned === "object" && plan.abandoned.length > 0)
      return {
        kind: "summarize",
        tip: checked.tip,
        plan,
        instructions: abandoned.summarize.instructions ?? null,
      };

    const fenced = checked.run === null ? null : await fence(kernel, session, checked.run);

    const outcome = await commit(kernel, [
      ...(fenced?.kind === "live" ? fenced.updates : []),
      {
        name: inboxRef(session, head),
        target: checked.inbox.ref?.target ?? null,
        expect: readRefExpectation(checked.inbox.ref),
      },
      {
        name: receiptRef(session, id),
        target: await put(kernel.store, "receipt", {
          id,
          kind: "move",
          digest,
          outcome: null,
          move: { head, position },
        }),
        expect: "absent",
      },
      {
        name: headRef(session, head),
        target: plan.landing === null ? null : toCommitObjectId(plan.landing),
        expect: readRefExpectation(checked.tip.ref),
        events: [{ head, kind: "head", from: checked.tip.id, to: plan.landing, reason: "moved" }],
      },
    ]);

    if (outcome.kind !== "set")
      return outcome.name === receiptRef(session, id) &&
        (await known(kernel.store, session, id, "move", digest))
        ? { kind: "replayed" }
        : STALE;

    return {
      kind: "moved",
      stopped: fenced === null || fenced.kind === "ended" ? null : checked.run,
      outcome: {
        kind: "moved",
        revision:
          plan.landing === null ? EMPTY_REVISION : (outcome.revisions.at(-1) ?? EMPTY_REVISION),
        position: createPosition(plan.landing),
        summary: null,
        handback: plan.handback,
      },
    };
  });
}

function planHistoryMove(
  commits: ReadonlyMap<CommitId, CommitRecord>,
  tip: CommitId | null,
  position: Position,
): Plan | null {
  const plan = (landing: CommitId | null, handback: UserContent | null): Plan => {
    const kept = new Set(walkCommitPath(commits, landing));

    return {
      landing,
      handback,
      abandoned: walkCommitPath(commits, tip).filter((id) => !kept.has(id)),
    };
  };

  if (position.kind === "start") return plan(null, null);
  const target = commits.get(position.id);

  if (target === undefined) return null;

  return target.body.kind === "user"
    ? plan(target.parent, target.body.content)
    : plan(position.id, null);
}

export async function recoverMoves(kernel: Kernel, session: SessionId): Promise<void> {
  const prefix = receiptRef(session, asId<"receipt">(""));

  for (const ref of await kernel.store.sessions.pending({ kind: "receipt", sessions: [session] }))
    await recover(kernel, session, asId<"receipt">(ref.name.slice(prefix.length)));
}

async function recover(kernel: Kernel, session: SessionId, id: ReceiptId): Promise<void> {
  const found = await readReceipt(kernel.store, session, id);

  if (found === null || found.record.outcome !== null || summaryHeld(kernel, session, id)) return;
  const moved = found.record.kind === "move" ? found.record.move : undefined;

  if (moved === undefined) {
    const interrupted =
      found.record.kind === "move" ||
      (found.record.kind === "send" &&
        found.record.id === id &&
        !(await withFold(kernel, session, (state) => state.inputs.has(asId<"message">(id)))));

    if (interrupted && (found.record.kind === "send" || found.record.kind === "move"))
      await settleReceipt(kernel, session, id, {
        kind: found.record.kind,
        outcome: { kind: "summary-failed", reason: "The summary was interrupted." },
      });

    return;
  }
  const tip = await readTip(kernel.store, session, moved.head);

  const plan = await withFold(kernel, session, (state) =>
    planHistoryMove(state.commits, tip.id, moved.position),
  );

  if (plan === null) return;

  await settleReceipt(kernel, session, id, {
    kind: "move",
    outcome: {
      kind: "moved",
      revision: tip.ref?.revision ?? EMPTY_REVISION,
      position: createPosition(plan.landing),
      summary: null,
      handback: plan.handback,
    },
  });
}
