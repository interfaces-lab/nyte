import type { AdvanceReport } from "@nyte-ai/schema";

export type DriveStep =
  | { readonly kind: "advance" }
  | { readonly kind: "sleep"; readonly ms: number }
  | { readonly kind: "stop" };

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
