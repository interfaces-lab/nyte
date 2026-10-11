import type { AdvanceReport } from "@nyte-ai/schema";

/** Returns what the drive does after one advance: advance again, sleep `ms`, or stop. */
export type DriveStep =
  | { readonly kind: "advance" }
  | { readonly kind: "sleep"; readonly ms: number }
  | { readonly kind: "stop" };

/** Returns the drive's next step after one report: `continue` advances again; `waiting` with a timer and `retry` sleep until `until`, or advance again once it passed; `idle`, `fenced`, `waiting` with no timer and `busy` stop: `busy` means another instance holds the head's lease and its loop re-reads after each turn, so it sees the wake and this workflow ends (§42s); a later dispatch or the repair cron starts a new drive. */
export function stepFrom(report: AdvanceReport, now: number): DriveStep {
  switch (report.kind) {
    case "continue":
      return { kind: "advance" };
    case "waiting":
      return report.until === null ? { kind: "stop" } : untilStep(report.until, now);
    case "retry":
      return untilStep(report.until, now);
    case "busy":
    case "idle":
    case "fenced":
      return { kind: "stop" };
  }
}

function untilStep(until: number, now: number): DriveStep {
  return until > now ? { kind: "sleep", ms: until - now } : { kind: "advance" };
}
