import type {
  AdvanceReport,
  Cursor,
  ExecutionCoverage,
  HeadName,
  Owned,
  RepairPage,
  SessionId,
} from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";

/** Takes the execution lease on every head the coverage names and renews it every 10 s until the returned handle is closed. */
export function cover(kernel: Kernel, coverage: ExecutionCoverage): Promise<Owned> {
  throw new Error("not implemented");
}

/** Runs one leased kernel step on a head: renews the lease, lands due inputs, runs a turn when one is owed, and reports what comes next. */
export function advance(
  kernel: Kernel,
  input: { readonly session: SessionId; readonly head: HeadName },
): Promise<AdvanceReport> {
  throw new Error("not implemented");
}

/** Returns one page of heads with a steer or queue input waiting and no live run. */
export function repair(
  kernel: Kernel,
  input: { readonly cursor?: Cursor; readonly limit: number },
): Promise<RepairPage> {
  throw new Error("not implemented");
}

/** Drives covered heads in process: on each wake, advances the head until idle, waiting, retry, busy or fenced, one advance in flight per head; closing the handle stops it. */
export function driveInProcess(kernel: Kernel, coverage: ExecutionCoverage): Owned {
  throw new Error("not implemented");
}
