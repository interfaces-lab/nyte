import type { JobActionOutcome } from "@nyte-ai/protocol";

export function jobActionMessage(outcome: JobActionOutcome): string {
  switch (outcome.kind) {
    case "applied":
      return "Cancellation requested.";
    case "not_found":
      return "This task is no longer available.";
    case "finished":
      return "This task has already finished. Its output is still available.";
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}
