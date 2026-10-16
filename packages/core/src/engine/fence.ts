import type { Failure } from "@nyte-ai/schema/model";
import type { HeadName, RefUpdate, RunEnd, RunId, SessionId, StopOutcome } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { decodeRunRecord } from "../contract/records.ts";
import { commit } from "../fold/commit.ts";
import { liveParts, readRunEnd } from "../fold/reads.ts";
import { stoppedParts } from "../store/parts.ts";
import { inboxRef, runRef } from "../store/refs.ts";
import {
  attempt,
  inboxWithout,
  load,
  put,
  readInbox,
  readRefExpectation,
  readTip,
  STALE,
} from "../store/session.ts";

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

  kernel.runs.abort(run);
  await kernel.waits.runStopped(session, run);
  kernel.wakes.notify(session, fenced.head);

  return { kind: "requested" };
}

export async function fence(kernel: Kernel, session: SessionId, run: RunId): Promise<Fence> {
  const found = await load(
    kernel,
    await kernel.store.refs.get(runRef(session, run)),
    decodeRunRecord,
  );

  if (found === null) return { kind: "ended" };
  const head = found.record.view.head;

  if (found.record.stopping) return { kind: "stopping", head };

  const [live, inbox, tip] = await Promise.all([
    liveParts(kernel, session, run),
    readInbox(kernel, session, head),
    readTip(kernel, session, head),
  ]);

  const [stopping, stopped, rewritten] = await Promise.all([
    put(kernel, "run", { ...found.record, stopping: true }),
    stoppedParts(kernel, session, head, tip, live, FENCED),
    put(kernel, "inbox", inboxWithout(inbox, [])),
  ]);

  return {
    kind: "live",
    head,
    updates: [
      {
        name: runRef(session, run),
        target: stopping,
        expect: found.ref.revision,
        event: { head, kind: "run", run, change: "stopping" },
      },
      ...stopped,
      { name: inboxRef(session, head), target: rewritten, expect: readRefExpectation(inbox.ref) },
    ],
  };
}

export async function unfenced(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<RefUpdate | null> {
  const found = await load(
    kernel,
    await kernel.store.refs.get(runRef(session, run)),
    decodeRunRecord,
  );

  return found === null || found.record.stopping
    ? null
    : { name: found.ref.name, target: found.ref.target, expect: found.ref.revision };
}

/** Whether the run's stop fence is set in the store, the one record of a stop; a run whose record is gone has ended and is not stopping. */
export async function stopRequested(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<boolean> {
  const found = await load(
    kernel,
    await kernel.store.refs.get(runRef(session, run)),
    decodeRunRecord,
  );

  return found?.record.stopping === true;
}

/** Stops this process's work on a run whose stop fence a write found already set. */
export function abortHere(kernel: Kernel, run: RunId): void {
  kernel.runs.abort(run);
}
