import { asId } from "@nyte-ai/schema";
import type { CommitId, HeadName, PartId, Placement, RefUpdate, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { CommitRecord, PartRecord } from "./records.ts";
import { headRef, partRef } from "./refs.ts";
import { expectOf, objectOf, put, putCommit } from "./session-state.ts";
import type { Tip } from "./session-state.ts";

const NOTE: Placement = { kind: "transcript", role: "note" };

/** Summarises abandoned commits with the kernel's summariser; a thrown error is a failure with its message. */
export async function summarize(
  kernel: Kernel,
  input: Parameters<Kernel["summarize"]>[0],
): ReturnType<Kernel["summarize"]> {
  try {
    return await kernel.summarize(input);
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Stores a branch summary part and its commit on `landing`, and returns the updates that publish them and move the head there from `tip`: `[part created, part settled, commit, head moved]`, the head's compare-and-set on the commit entry. */
export async function summaryUpdates(
  kernel: Kernel,
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

  const commit = await putCommit(kernel, record);

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

  const target = await put(kernel, "part", stored, at);

  return {
    commit,
    part,
    updates: [
      {
        name: partRef(session, part),
        target,
        expect: "absent",
        event: {
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
      },
      {
        name: partRef(session, part),
        target,
        event: { head, kind: "part", part, change: "settled", commit, endedAt: at },
      },
      {
        name: headRef(session, head),
        target: objectOf(commit),
        expect: expectOf(tip.ref),
        event: {
          head,
          kind: "commit",
          id: commit,
          parent: record.parent,
          run: null,
          body: record.body,
        },
      },
      {
        name: headRef(session, head),
        target: objectOf(commit),
        event: { head, kind: "head", from: tip.id, to: commit, reason: "moved" },
      },
    ],
  };
}
