import type { Failure, HeadName, RefUpdate, RunId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { RunRecord } from "../contract/records.ts";
import type { StoreConnection } from "../contract/store.ts";
import { headRef, runCallsPrefix, runRef } from "../store/refs.ts";
import { withFold } from "../fold/reads.ts";
import { liveRun, put } from "../store/session.ts";
import { objectId } from "../util/content.ts";
import { dev } from "../util/dev-log.ts";

export const RESTART_LIMIT = 5;

export function crashLooping(record: RunRecord): boolean {
  return (record.interrupted?.count ?? 0) >= RESTART_LIMIT;
}

export function parkedFailure(record: RunRecord): Failure {
  return {
    class: "runner",
    message: `Stopped after Nyte was interrupted ${String(record.interrupted?.count ?? RESTART_LIMIT)} times while working on this, with no progress in between. Send a message to continue.`,
  };
}

/**
 * Counts an interruption of the head's live run into the claim that takes it over: the previous
 * holder's lease was still there (`foreign`), or a response it streamed was cut off, as when this
 * host lost its own lease mid-stream.
 */
export async function interruption(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  foreign: boolean,
): Promise<readonly RefUpdate[]> {
  const live = await liveRun(kernel.store, session, head);

  if (live === null || kernel.executionState.driving.has(live.record.view.id)) return [];
  const run = live.record.view.id;

  if (!foreign && !(await responseCut(kernel, session, run))) return [];
  const mark = await progressMark(kernel.store, session, head, run);
  const count = live.record.interrupted?.mark === mark ? live.record.interrupted.count + 1 : 1;
  dev("execution", "interrupted", { session, head, run, count });

  return [
    {
      name: runRef(session, run),
      target: await put(kernel.store, "run", { ...live.record, interrupted: { count, mark } }),
      expect: live.ref.revision,
    },
  ];
}

/** Whether a response of the run was cut off: a text or thinking part is still live with no one driving the run, the parts `resumed` in turn.ts retries. */
function responseCut(kernel: Kernel, session: SessionId, run: RunId): Promise<boolean> {
  return withFold(kernel, session, (state) =>
    [...state.parts.values()].some(
      (part) =>
        part.run === run &&
        part.status.kind === "live" &&
        (part.partKind === "text" || part.partKind === "thinking"),
    ),
  );
}

/** Where the head and the run's calls stand: an interruption at the same mark as the last made no progress in between. */
export async function progressMark(
  store: StoreConnection,
  session: SessionId,
  head: HeadName,
  run: RunId,
): Promise<string> {
  const [tip, calls] = await Promise.all([
    store.refs.get(headRef(session, head)),
    store.refs.list(runCallsPrefix(session, run)),
  ]);

  return objectId([tip?.revision ?? null, ...calls.map((ref) => `${ref.name}@${ref.revision}`)]);
}
