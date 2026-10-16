import { asId } from "@nyte-ai/schema";
import type {
  CommitId,
  HeadName,
  PartId,
  Placement,
  ReceiptId,
  RefUpdate,
  Revision,
  RunId,
  SessionId,
} from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { CommitRecord, PartRecord, ReceiptRecord } from "../contract/records.ts";
import { commit } from "../fold/commit.ts";
import { withFold } from "../fold/reads.ts";
import { headRef, partRef } from "../store/refs.ts";
import {
  attempt,
  EMPTY_REVISION,
  guard,
  put,
  readReceipt,
  readRefExpectation,
  STALE,
  staleHead,
  toCommitObjectId,
  walkCommitPath,
} from "../store/session.ts";
import type { Found, Inbox, MoveFailure, Tip } from "../store/session.ts";
import { fence } from "./fence.ts";
import type { StoreConnection } from "../contract/store.ts";

const NOTE: Placement = { kind: "transcript", role: "note" };

type Summarized =
  | { readonly kind: "failed"; readonly outcome: MoveFailure }
  | { readonly kind: "settled" }
  | {
      readonly kind: "moved";
      readonly revision: Revision;
      readonly commit: CommitId;
      readonly part: PartId;
      readonly stopped: RunId | null;
    };

export function holdSummary(kernel: Kernel, session: SessionId, id: ReceiptId): () => void {
  const key = JSON.stringify([session, id]);
  kernel.executionState.summaries.add(key);

  return () => {
    kernel.executionState.summaries.delete(key);
  };
}

export function summaryHeld(kernel: Kernel, session: SessionId, id: ReceiptId): boolean {
  return kernel.executionState.summaries.has(JSON.stringify([session, id]));
}

export async function summarizedMove(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly receipt: ReceiptId;
    readonly tip: Tip;
    readonly landing: CommitId | null;
    readonly instructions: string | null;
    readonly running: "refuse" | "stop";
    readonly updates: (read: {
      readonly inbox: Inbox;
      readonly receipt: Found<ReceiptRecord>;
      readonly stopped: RunId | null;
      readonly commit: CommitId;
    }) => Promise<readonly RefUpdate[]>;
  },
): Promise<Summarized> {
  const { session, head, tip } = input;

  const abandoned = await withFold(kernel, session, (state) => {
    const kept = new Set(walkCommitPath(state.commits, input.landing));

    return walkCommitPath(state.commits, tip.id).filter((id) => !kept.has(id));
  });

  const summary = await summarize(kernel, {
    session,
    head,
    commits: abandoned,
    instructions: input.instructions,
    signal: kernel.executionState.closing.signal,
  });

  if (summary.kind === "failed")
    return { kind: "failed", outcome: { kind: "summary-failed", reason: summary.reason } };

  const written = await summaryUpdates(kernel.store, {
    session,
    head,
    tip,
    landing: input.landing,
    abandoned,
    markdown: summary.markdown,
  });

  return attempt<Summarized>(`Moving ${head}`, async () => {
    const checked = await guard(kernel.store, session, head, undefined, input.running);

    if ("kind" in checked) return { kind: "failed", outcome: checked };
    const receipt = await readReceipt(kernel.store, session, input.receipt);

    if (receipt === null || receipt.record.outcome !== null) return { kind: "settled" };
    const fenced = checked.run === null ? null : await fence(kernel, session, checked.run);
    const stopped = fenced === null || fenced.kind === "ended" ? null : checked.run;

    const moving = [...(fenced?.kind === "live" ? fenced.updates : []), ...written.updates];

    const outcome = await commit(kernel, [
      ...moving,
      ...(await input.updates({
        inbox: checked.inbox,
        receipt,
        stopped,
        commit: written.commit,
      })),
    ]);

    if (outcome.kind !== "set")
      return outcome.name === headRef(session, head)
        ? { kind: "failed", outcome: await staleHead(kernel.store, session, head) }
        : STALE;

    return {
      kind: "moved",
      revision: outcome.revisions[moving.length - 1] ?? EMPTY_REVISION,
      commit: written.commit,
      part: written.part,
      stopped,
    };
  });
}

async function summarize(
  kernel: Kernel,
  input: Parameters<Kernel["summarize"]>[0],
): ReturnType<Kernel["summarize"]> {
  try {
    return await kernel.summarize(input);
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

async function summaryUpdates(
  store: StoreConnection,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly tip: Tip;
    readonly landing: CommitId | null;
    readonly abandoned: readonly CommitId[];
    readonly markdown: string;
  },
): Promise<{
  readonly commit: CommitId;
  readonly part: PartId;
  readonly updates: readonly RefUpdate[];
}> {
  const { session, head, tip } = input;
  const at = Date.now();
  const part = asId<"part">(crypto.randomUUID());
  const state = { markdown: input.markdown };

  const record: CommitRecord = {
    parent: input.landing,
    at,
    run: null,
    body: { kind: "branchSummary", part, replaces: input.abandoned },
  };

  const commit = asId<"commit">(await put(store, "commit", record, record.at));

  const stored: PartRecord = {
    id: part,
    partKind: "branchSummary",
    placement: NOTE,
    state,
    version: 1,
    owner: null,
    run: null,
    status: { kind: "settled", commit, endedAt: at },
  };

  const target = await put(store, "part", stored, at);

  return {
    commit,
    part,
    updates: [
      {
        name: partRef(session, part),
        target,
        expect: "absent",
        events: [
          {
            head,
            kind: "part",
            part,
            change: "created",
            partKind: "branchSummary",
            placement: NOTE,
            state,
            version: 1,
            run: null,
            owner: null,
          },
        ],
      },
      {
        name: partRef(session, part),
        target,
        events: [{ head, kind: "part", part, change: "settled", commit, endedAt: at }],
      },
      {
        name: headRef(session, head),
        target: toCommitObjectId(commit),
        expect: readRefExpectation(tip.ref),
        events: [
          {
            head,
            kind: "commit",
            id: commit,
            parent: record.parent,
            run: null,
            body: record.body,
          },
        ],
      },
      {
        name: headRef(session, head),
        target: toCommitObjectId(commit),
        events: [{ head, kind: "head", from: tip.id, to: commit, reason: "moved" }],
      },
    ],
  };
}
