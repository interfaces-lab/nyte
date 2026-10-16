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
  const unmark = kernel.runs.get(run) === undefined ? null : kernel.runs.markStopping(run);
  let fenced: Exclude<Fence, { readonly kind: "live" }>;

  try {
    fenced = await attempt(`Stopping run ${run}`, async () => {
      const read = await fence(kernel, session, run);

      if (read.kind !== "live") return read;

      return (await commit(kernel, read.updates)).kind === "set"
        ? { kind: "stopping", head: read.head }
        : STALE;
    });
  } catch (error) {
    unmark?.();

    throw error;
  }

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

export function abortHere(kernel: Kernel, run: RunId): void {
  if (kernel.runs.get(run) === undefined) return;
  kernel.runs.markStopping(run);
  kernel.runs.abort(run);
}
