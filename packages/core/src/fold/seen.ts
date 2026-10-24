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
  walkCommitPath,
} from "../store/session.ts";
import { commit } from "./commit.ts";
import { withFold } from "./reads.ts";

export async function advanceSeen(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly principal: PrincipalId;
    readonly head: HeadName;
    readonly commit: CommitId;
  },
): Promise<void> {
  const name = seenRef(input.session, input.principal, input.head);
  const record: SeenRecord = { commit: input.commit };

  await attempt(`Marking ${input.head} seen`, async () => {
    const ref = await kernel.store.refs.get(name);
    const mark = (await load(kernel.store, ref, decodeSeenRecord))?.record.commit ?? null;

    if (mark === input.commit) return true;

    const unchanged = await withFold(kernel, input.session, (state) => {
      const folded = state.heads.get(input.head);

      if (folded === undefined) return true;

      return (
        mark !== null &&
        walkCommitPath(state.commits, readPositionCommit(folded.info.tip)).includes(mark) &&
        walkCommitPath(state.commits, mark).includes(input.commit)
      );
    });

    if (unchanged) return true;

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
