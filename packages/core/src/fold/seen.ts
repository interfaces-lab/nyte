import type { CommitId, HeadName, PrincipalId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { decodeSeenRecord } from "../contract/records.ts";
import type { SeenRecord } from "../contract/records.ts";
import { seenRef } from "../store/refs.ts";
import {
  attempt,
  load,
  put,
  readPositionCommit,
  readRefExpectation,
  STALE,
  START,
  walkCommitPath,
} from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { commit } from "./commit.ts";
import { withFold } from "./reads.ts";

const SEEN_DELAY = 16;

async function advanceSeen(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly principal: PrincipalId;
    readonly head: HeadName;
    readonly commit: CommitId | null;
  },
): Promise<void> {
  const name = seenRef(input.session, input.principal, input.head);
  const record: SeenRecord = { commit: input.commit };

  await attempt(`Marking ${input.head} seen`, async () => {
    const ref = await kernel.store.refs.get(name);
    const mark = (await load(kernel.store, ref, decodeSeenRecord))?.record.commit ?? null;

    if (ref !== null && mark === input.commit) return true;

    if (
      mark !== null &&
      (await withFold(kernel, input.session, (state) => {
        const tip = state.heads.get(input.head)?.info.tip ?? START;

        return (
          walkCommitPath(state.commits, readPositionCommit(tip)).includes(mark) &&
          (input.commit === null || walkCommitPath(state.commits, mark).includes(input.commit))
        );
      }))
    )
      return true;

    const outcome = await commit(kernel, [
      {
        name,
        target: await put(kernel.store, "seen", record),
        expect: readRefExpectation(ref),
        events: [
          {
            head: input.head,
            kind: "seen",
            principal: input.principal,
            commit: input.commit,
          },
        ],
      },
    ]);

    return outcome.kind === "set" ? true : STALE;
  });
}

export function seenWriter(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly principal: PrincipalId;
    readonly head: HeadName;
  },
) {
  let pending: { readonly tip: CommitId | null } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    const next = pending;
    pending = null;

    if (next === null) return writing;

    writing = writing
      .then(() => advanceSeen(kernel, { ...input, commit: next.tip }))
      .catch((error: unknown) =>
        dev("watch", "seen failed", {
          session: input.session,
          head: input.head,
          error: String(error),
        }),
      );

    return writing;
  };

  return {
    note(tip: CommitId | null) {
      pending = { tip };
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), SEEN_DELAY);
    },
    flush,
  };
}
