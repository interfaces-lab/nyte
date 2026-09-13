import {
  DEFAULT_LANDING,
  isTerminalPhase,
  type Landing,
  type WaitOutcome,
} from "@nyte-ai/protocol";
import { landsNow } from "../admission.ts";
import { listEffects, waitingBatchReady } from "../effects.ts";
import { headRef, runRef } from "../names.ts";
import { pending } from "../queue.ts";
import type { Session } from "../store.ts";

/** A lease release has no event. Poll only while the head would otherwise be settled. */
async function untilLeaseReleased(
  session: Session,
  name: string,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    if ((await session.leases.read(name)) === undefined || signal.aborted) return;
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, 5);
      signal.addEventListener("abort", finish, { once: true });
    });
  }
}

/**
 * Observe settlement without acquiring a lease or changing the run. `drain` is
 * the runner's, so the waiter judges the batch the runner would land next.
 */
export async function waitForHead(
  session: Session,
  input: {
    readonly head: string;
    readonly signal?: AbortSignal;
    readonly drain?: Landing["drain"];
  },
): Promise<WaitOutcome> {
  const drain = input.drain ?? DEFAULT_LANDING.drain;
  if (input.signal?.aborted) return { kind: "cancelled" };
  const stop = new AbortController();
  const abort = (): void => stop.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    // Capture before inspecting state so a concurrent publication is replayed.
    const cursor = await session.events.last();
    const status = async (): Promise<WaitOutcome | undefined> => {
      for (;;) {
        if (stop.signal.aborted) return { kind: "cancelled" };
        const observedSeq = await session.events.last();
        const oid = await session.refs.read(runRef(input.head));
        const run = oid === null ? undefined : await session.objects.get(oid);
        if (oid !== null && run?.kind !== "run") {
          throw new Error(`Corrupt run ref ${runRef(input.head)} at ${oid}`);
        }
        const queued = await pending(session, input.head);
        let settled: WaitOutcome;
        if (run?.kind === "run" && run.phase.kind === "waiting") {
          if (run.abortRequested === true) return undefined;
          const effects = await listEffects(session, run.id);
          if (waitingBatchReady(effects)) return undefined;
          settled = { kind: "waiting", runId: run.id };
        } else {
          if (run?.kind === "run" && !isTerminalPhase(run.phase)) return undefined;
          // The runner lands a lane only when the head admits its next batch. An
          // idle head keeps completed background work queued until user input.
          if (landsNow(run?.kind === "run" ? run : undefined, queued, drain)) return undefined;
          settled = { kind: "idle" };
        }
        // Publication and lease release are separate writes. Neither idle nor
        // parked is promised until the holder lets go; then re-read the state.
        const lease = await session.leases.read(headRef(input.head));
        if (stop.signal.aborted) return { kind: "cancelled" };
        if (lease === undefined) {
          // Every ref read above is stable only when no atomic ref event landed around it.
          if ((await session.events.last()) !== observedSeq) continue;
          return settled;
        }
        await untilLeaseReleased(session, headRef(input.head), stop.signal);
      }
    };
    const initial = await status();
    if (stop.signal.aborted) return { kind: "cancelled" };
    if (initial !== undefined) return initial;
    for await (const _event of session.events.watch({ afterSeq: cursor, signal: stop.signal })) {
      const next = await status();
      if (stop.signal.aborted) return { kind: "cancelled" };
      if (next !== undefined) return next;
    }
    if (stop.signal.aborted) return { kind: "cancelled" };
    const final = await status();
    if (final !== undefined) return final;
    throw new Error("Session event watch ended before the head settled");
  } finally {
    stop.abort();
    input.signal?.removeEventListener("abort", abort);
  }
}
