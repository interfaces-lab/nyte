import type { Disposer } from "@nyte-ai/schema";
import { followLog, followedSessions } from "./follow.ts";
import { rereadFences } from "./driving.ts";
import type { Kernel } from "./kernel.ts";
import { recheckAnswers } from "./part-table.ts";

/** Re-reads the store a kernel shares with other instances every `kernel.poll` ms (§42h, §42u), one pass at a time: for each session a fold or a watch follows here, the events another instance logged since this kernel last published (`followLog`, so `head.watch` and the fold see another instance's commits with their revisions); then the parked waits against what the store settled (`kernel.waits.recheck()`); then each modal part with a pending local `answer()`, through the call its status names waiting on it (`recheckAnswers`, §42ac); then the stop fence of every run a turn drives here, aborting a turn stopped elsewhere (`rereadFences`). A pass that throws is dropped and the next one tries again. A kernel without `poll` polls nothing. The disposer stops it. */
export function pollStore(kernel: Kernel): Disposer {
  const every = kernel.poll;

  if (every === null) return () => undefined;
  let running = false;
  let stopped = false;

  const pass = async (): Promise<void> => {
    for (const [session, from] of followedSessions(kernel.bus)) {
      if (from === null || stopped) continue;
      await followLog(kernel, session, from);
    }

    if (stopped) return;
    await kernel.waits.recheck();
    await recheckAnswers(kernel);
    await rereadFences(kernel);
  };

  const timer = setInterval(() => {
    if (running || stopped) return;
    running = true;
    pass()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, every);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
