import type {
  Configuration,
  HeadName,
  PatchEvent,
  RunEnd,
  RunId,
  RunView,
  SessionId,
  StopOutcome,
} from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { Run } from "./run.ts";

/** Starts a run on a head: mints its id, writes its `RunRecord` with `run started`, and opens its controller in `kernel.runs`. */
export function startRun(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  origin: RunView["origin"],
  configuration: Configuration,
): Promise<RunView> {
  throw new Error("not implemented");
}

/** Stops one run at the fence: marks it stopping and aborts its signal before any await, then publishes `run stopping` and fails its live parts in one set; resolves `requested`, and the cleanup settles it. */
export function stopRun(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<StopOutcome<RunEnd>> {
  throw new Error("not implemented");
}

/** Ends a run: deletes its ref, records the head's `lastRun`, publishes `run ended`, settles every send receipt whose message landed in this run, delivers a child's report, and wakes the head when input is queued. */
export function endRun(kernel: Kernel, session: SessionId, run: RunId, end: RunEnd): Promise<void> {
  throw new Error("not implemented");
}

/** Returns a handle on one run: `stop()` is the fence; `settled()` waits for `run ended`, or reads the head's `lastRun` after a restart. Binds synchronously; no I/O. */
export function runHandle(kernel: Kernel, session: SessionId, id: RunId): Run {
  throw new Error("not implemented");
}

/** Publishes a transient patch to a run's part, or drops it once the run is stopping. */
export function publishPatch(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  patch: PatchEvent,
): void {
  throw new Error("not implemented");
}
