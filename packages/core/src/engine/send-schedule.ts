import type { Configuration, Delivery, Schedule, Submission } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { RunRecord } from "../contract/records.ts";
import { objectId } from "../util/content.ts";

/** The submission as it lands: a `steer` becomes a `queue` while the live run's model takes no message mid-turn, so every client's steer waits for the turn alike. */
export function landed(kernel: Kernel, submission: Submission, run: RunRecord | null): Submission {
  return submission.delivery === "steer" &&
    run !== null &&
    !kernel.modelSteers(run.view.configuration.model)
    ? { ...submission, delivery: "queue" }
    : submission;
}

/** Where a landed message waits: attached to the next run, the next turn (idle, after the live run, or under another configuration), or joined to the live run. */
export async function chooseSendSchedule(
  delivery: Delivery,
  configuration: Configuration,
  run: RunRecord | null,
): Promise<Schedule> {
  if (delivery === "attach") return { kind: "attached" };

  if (run === null) return { kind: "next-turn", reason: "idle" };

  if (delivery === "queue" || run.stopping) return { kind: "next-turn", reason: "run-ended" };

  if ((await objectId(configuration)) !== (await objectId(run.view.configuration)))
    return { kind: "next-turn", reason: "configuration" };

  return { kind: "joined", run: run.view.id };
}
