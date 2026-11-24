import type { Failure, HeadName, RefUpdate, RunId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { decodeRunRecord } from "../contract/records.ts";
import type { RunRecord } from "../contract/records.ts";
import type { StoreConnection } from "../contract/store.ts";
import { headRef, runCallsPrefix, runRef } from "../store/refs.ts";
import { withFold } from "../watch/reads.ts";
import { attempt, liveRun, load, put, STALE } from "../store/session.ts";
import { commit } from "../watch/commit.ts";
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

export async function interruption(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  foreign: boolean,
): Promise<readonly RefUpdate[]> {
  const live = await liveRun(kernel.store, session, head);

  if (live === null || kernel.executionState.driving.has(live.record.view.id)) return [];
  const run = live.record.view.id;

  if (live.record.released === true) {
    const { released: _released, ...record } = live.record;

    return [
      {
        name: runRef(session, run),
        target: await put(kernel.store, "run", record),
        expect: live.ref.revision,
      },
    ];
  }

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

export async function releaseRun(kernel: Kernel, session: SessionId, run: RunId): Promise<null> {
  if (kernel.presence?.revoked.aborted === true) return null;

  return attempt(`Releasing run ${run}`, async () => {
    const found = await load(
      kernel.store,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found === null || found.record.released === true) return null;

    const outcome = await commit(kernel, [
      {
        name: runRef(session, run),
        target: await put(kernel.store, "run", { ...found.record, released: true }),
        expect: found.ref.revision,
      },
    ]);

    return outcome.kind === "set" ? null : STALE;
  });
}

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
