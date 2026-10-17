import type {
  Failure,
  HeadName,
  RefUpdate,
  RunEnd,
  RunId,
  SessionId,
  StopOutcome,
} from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { decodeRunRecord } from "../contract/records.ts";
import { commit } from "../fold/commit.ts";
import { liveParts, readRunEnd } from "../fold/reads.ts";
import { stoppedParts } from "../store/parts.ts";
import { inboxRef, liveRef, runRef } from "../store/refs.ts";
import {
  attempt,
  inboxWithout,
  load,
  put,
  readCall,
  readInbox,
  readRefExpectation,
  readSession,
  readTip,
  STALE,
} from "../store/session.ts";
import { readParkedWait } from "./waits.ts";
import type { StoreConnection } from "../contract/store.ts";

export const FENCED: Failure = { class: "aborted", message: "Stopped." };

type Fence =
  | { readonly kind: "ended" }
  | { readonly kind: "stopping"; readonly head: HeadName }
  | { readonly kind: "live"; readonly head: HeadName; readonly updates: readonly RefUpdate[] };

export async function stopRun(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<StopOutcome<RunEnd>> {
  const fenced = await attempt(
    `Stopping run ${run}`,
    async (): Promise<Exclude<Fence, { readonly kind: "live" }> | typeof STALE> => {
      const read = await fence(kernel, session, run);

      if (read.kind !== "live") return read;

      return (await commit(kernel, read.updates)).kind === "set"
        ? { kind: "stopping", head: read.head }
        : STALE;
    },
  );

  if (fenced.kind === "ended") {
    const end = await readRunEnd(kernel, session, run);

    return end === null ? { kind: "missing" } : { kind: "settled", outcome: end };
  }

  await finishFence(kernel, session, run);
  await stopWaitedChildren(kernel, session, run);
  await kernel.waits.runStopped(session, run);
  kernel.wakes.notify(session, fenced.head);

  return { kind: "requested" };
}

/** Stops each run of this session's subagents that `run` is parked waiting on, as a `task` call waits on the child it started: the work it waited for is part of what the user stopped. */
async function stopWaitedChildren(kernel: Kernel, session: SessionId, run: RunId): Promise<void> {
  const found = await load(
    kernel.store,
    await kernel.store.refs.get(runRef(session, run)),
    decodeRunRecord,
  );

  const waited = await Promise.all(
    (found?.record.parked ?? []).map(async (call) => {
      const parked = readParkedWait(
        session,
        (await readCall(kernel.store, session, call))?.record ?? null,
      );

      if (parked === null) return [];

      return ("targets" in parked.target ? parked.target.targets : [parked.target]).flatMap(
        (target) => (target.kind === "run" ? [target] : []),
      );
    }),
  );

  for (const target of waited.flat()) {
    const child = await readSession(kernel.store, target.session);

    if (child?.record.parent === session) await stopRun(kernel, target.session, target.run);
  }
}

export async function fence(kernel: Kernel, session: SessionId, run: RunId): Promise<Fence> {
  const found = await load(
    kernel.store,
    await kernel.store.refs.get(runRef(session, run)),
    decodeRunRecord,
  );

  if (found === null) return { kind: "ended" };
  const head = found.record.view.head;

  if (found.record.stopping) return { kind: "stopping", head };

  const [live, inbox, tip] = await Promise.all([
    liveParts(kernel, session, run),
    readInbox(kernel.store, session, head),
    readTip(kernel.store, session, head),
  ]);

  const [stopping, stopped, rewritten] = await Promise.all([
    put(kernel.store, "run", { ...found.record, stopping: true }),
    stoppedParts(kernel.store, session, head, tip, live, FENCED),
    put(kernel.store, "inbox", inboxWithout(inbox, [])),
  ]);

  return {
    kind: "live",
    head,
    updates: [
      {
        name: runRef(session, run),
        target: stopping,
        expect: found.ref.revision,
        events: [{ head, kind: "run", run, change: "stopping" }],
      },
      { name: liveRef(session, run), target: null },
      ...stopped,
      { name: inboxRef(session, head), target: rewritten, expect: readRefExpectation(inbox.ref) },
    ],
  };
}

/** Whether the run's stop fence is set in the store, the one record of a stop; a run whose record is gone has ended and is not stopping. */
export async function stopRequested(
  store: StoreConnection,
  session: SessionId,
  run: RunId,
): Promise<boolean> {
  const found = await load(store, await store.refs.get(runRef(session, run)), decodeRunRecord);

  return found?.record.stopping === true;
}

/** Stops this process's work on a run whose stop fence is set, and fails what the run opened between the fence's read and its write: with the live ref gone nothing opens under the run any more, so this pass sees the last of them. */
export async function finishFence(kernel: Kernel, session: SessionId, run: RunId): Promise<void> {
  kernel.runs.abort(run);

  await attempt(`Failing what run ${run} opened while it stopped`, async () => {
    const open = await liveParts(kernel, session, run);

    if (open.length === 0) return undefined;
    const found = await load(
      kernel.store,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found === null) return undefined;
    const head = found.record.view.head;
    const tip = await readTip(kernel.store, session, head);
    const updates = await stoppedParts(kernel.store, session, head, tip, open, FENCED);

    if (updates.length === 0) return undefined;

    return (await commit(kernel, updates)).kind === "set" ? undefined : STALE;
  });
}
