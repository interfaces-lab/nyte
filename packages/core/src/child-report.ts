import type { RunEnd, RunId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";

/** Delivers a child run's report exactly once: wakes the durable wait parked on that run, or else attaches a bounded report to the parent's originating head. */
export function deliverChildReport(
  kernel: Kernel,
  child: SessionId,
  run: RunId,
  end: RunEnd,
): Promise<void> {
  throw new Error("not implemented");
}
