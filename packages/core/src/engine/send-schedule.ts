import type { Delivery, ModelRef, Schedule, Submission } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { RunRecord } from "../contract/records.ts";

export function landed(
  kernel: Kernel,
  submission: Submission,
  run: RunRecord | null,
  model: ModelRef,
): Submission {
  return submission.delivery === "steer" && run !== null && !kernel.modelSteers(model)
    ? { ...submission, delivery: "queue" }
    : submission;
}

export function chooseSendSchedule(delivery: Delivery, run: RunRecord | null): Schedule {
  if (delivery === "attach") return { kind: "attached" };

  if (run === null) return { kind: "next-turn", reason: "idle" };

  if (delivery === "queue" || run.stopping) return { kind: "next-turn", reason: "run-ended" };

  return { kind: "joined", run: run.view.id };
}
