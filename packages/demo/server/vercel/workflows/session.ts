import type { HeadName } from "@nyte-ai/core";
import { sleep } from "workflow";
import { advanceSession } from "../src/advance.ts";

export async function runSession(id: string, head: HeadName): Promise<void> {
  "use workflow";

  for (;;) {
    const outcome = await advanceSession(id, head);
    switch (outcome.kind) {
      case "continue":
      case "finished":
        continue;
      case "idle":
        return;
      case "waiting":
        // A reply starts another workflow; an unanswered selection needs no polling.
        if (outcome.until === undefined) return;
        await sleep(new Date(outcome.until));
        continue;
      case "retry":
        await sleep(new Date(outcome.at));
        continue;
      case "busy":
        // Recheck after ownership can expire. Returning here can lose a wake racing an idle step.
        await sleep(new Date(outcome.until + 1));
        continue;
      case "fenced":
        await sleep("1s");
        continue;
      default: {
        const _exhaustive: never = outcome;
        return _exhaustive;
      }
    }
  }
}
