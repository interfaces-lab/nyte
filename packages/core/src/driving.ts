import type { RunId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import { decodeRunRecord } from "./records.ts";
import { runRef } from "./refs.ts";
import { load } from "./session-state.ts";

const driving = new WeakMap<Kernel, Map<RunId, SessionId>>();

/** Returns the runs a turn drives in this process, each with its session: what `drive` adds while its turn runs. */
export function drivenBy(kernel: Kernel): Map<RunId, SessionId> {
  const driven = driving.get(kernel) ?? new Map<RunId, SessionId>();
  driving.set(kernel, driven);

  return driven;
}

/** Re-reads the stop fence of every run a turn drives in this process and, for one stopped elsewhere, passes the fence here then aborts the turn (§30, §42u): marks it stopping, aborts its signal and wakes its parked waits with `stopped`. What `pollStore` runs. */
export async function rereadFences(kernel: Kernel): Promise<void> {
  for (const [run, session] of Array.from(drivenBy(kernel))) {
    if (kernel.runs.isStopping(run)) continue;

    const found = await load(
      kernel,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found === null || !found.record.stopping) continue;
    kernel.runs.markStopping(run);
    kernel.runs.abort(run);
    await kernel.waits.runStopped(session, run);
  }
}
