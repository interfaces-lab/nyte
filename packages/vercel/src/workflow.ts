import type { Nyte } from "@nyte-ai/core";
import type { sleep } from "workflow";

export async function driveNyte({
  advance,
  wait,
}: {
  advance: () => ReturnType<Nyte["advance"]>;
  wait: typeof sleep;
}): Promise<void> {
  for (;;) {
    const outcome = await advance();

    switch (outcome.kind) {
      case "continue":
      case "finished":
        continue;
      case "idle":
        return;
      case "waiting":
        if (outcome.until === undefined) return;
        await wait(new Date(outcome.until));
        continue;
      case "retry":
        await wait(new Date(outcome.at));
        continue;
      case "busy":
        await wait(new Date(outcome.until + 1));
        continue;
      case "fenced":
        await wait("1s");
        continue;
      default: {
        const _exhaustive: never = outcome;

        return _exhaustive;
      }
    }
  }
}
