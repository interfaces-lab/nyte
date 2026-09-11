import type { JobActionOutcome, JobInfo } from "@nyte-ai/core";

const STATE_LABEL = {
  running: "Working",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Stopped",
  interrupted: "Interrupted",
} satisfies Readonly<Record<JobInfo["state"], string>>;

/** A job's state as the transcript, the tray, and the Agents panel all word it. */
export function jobStateLabel(job: Pick<JobInfo, "state" | "mode">): string {
  return job.state === "running" && job.mode === "background"
    ? "Background"
    : STATE_LABEL[job.state];
}

export function jobControls(job: JobInfo) {
  return {
    background: job.state === "running" && job.mode === "foreground",
    cancel: job.state === "running",
  };
}

export function jobActionMessage(
  outcome: JobActionOutcome,
  action: "background" | "cancel",
): string {
  switch (outcome.kind) {
    case "applied":
      return action === "background" ? "Running in background." : "Cancellation requested.";
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

export function taskSections(jobs: readonly JobInfo[]) {
  const eligible = jobs.filter((job) => job.kind === "subagent" || job.mode === "background");
  return {
    active: eligible.filter((job) => job.state === "running"),
    finished: eligible.filter((job) => job.state !== "running"),
    background: eligible.filter((job) => job.state === "running" && job.mode === "background")
      .length,
  };
}
