import type { AdvanceReport, HeadName, SessionId } from "@nyte-ai/schema";

/** Returns what the drive does after one advance: advance again, sleep `ms`, or stop. */
export type DriveStep =
  | { readonly kind: "advance" }
  | { readonly kind: "sleep"; readonly ms: number }
  | { readonly kind: "stop" };

/** Returns the drive's next step after one report: `continue` advances again; `waiting` with a timer and `retry` sleep until `until` (0 ms once it passed); `idle`, `fenced`, `waiting` with no timer and `busy` stop: `busy` means another instance holds the head's lease and its loop re-reads after each turn, so it sees the wake and this workflow ends (§42s); a later dispatch or the repair cron starts a new drive. */
export function stepFrom(report: AdvanceReport, now: number): DriveStep {
  throw new Error("not implemented");
}

/** The workflow (`"use workflow"`) that drives one head until it needs nothing: runs `advanceHead` as a step, then follows `stepFrom(report, Date.now())` — another step, Workflow's durable `sleep(ms)`, or return. */
export async function driveHead(input: {
  readonly session: SessionId;
  readonly head: HeadName;
}): Promise<void> {
  "use workflow";
  throw new Error("not implemented");
}

/** The step (`"use step"`) `driveHead` runs, on this instance's `vercelHost()`: opens `host.execution.cover({ kind: "sessions", sessions: [input.session] })`, which covers that session only (not its children) and claims nothing, so the session counts as covered here (§42a), its parked waits are loaded, and the lease `advance` claims for the head renews for the step's duration (§42h, §42t); fires the due timers and deadlines (`kernel.waits.tick(Date.now())`) so a timer the drive slept on wakes first; answers one `host.execution.advance(input)`; and closes the cover whatever the advance did. */
export async function advanceHead(input: {
  readonly session: SessionId;
  readonly head: HeadName;
}): Promise<AdvanceReport> {
  "use step";
  throw new Error("not implemented");
}
