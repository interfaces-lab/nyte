import type { Disposer } from "@nyte-ai/schema";
import { followLog, followedSessions } from "./follow.ts";
import { dev } from "./dev-log.ts";
import { rereadFences } from "./driving.ts";
import type { Kernel } from "./kernel.ts";
import { settleAnswersFrom } from "./part-table.ts";

/** Re-reads the store a kernel shares with other instances every `kernel.poll` ms (§42h, §42u), one pass at a time: for each session a fold or a watch follows here, the events another instance logged since this kernel last published (`followLog`, so `head.watch` and the fold see another instance's commits with their revisions); then the parked waits from what the store settled (`kernel.waits.settleFromStore()`); then each modal part with a pending local `answer()`, through the call its status names waiting on it (`settleAnswersFrom`, §42ac); then the stop fence of every run a turn drives here, aborting a turn stopped elsewhere (`rereadFences`). A pass that throws is dropped and the next one tries again. A kernel without `poll` polls nothing. The disposer stops it. */
export function pollStore(kernel: Kernel): Disposer {
  const every = kernel.poll;

  if (every === null) return () => undefined;
  let running = false;
  let stopped = false;

  const pass = async (): Promise<void> => {
    const followed = followedSessions(kernel.bus);
    dev("poll", "pass", { sessions: followed.size });

    for (const [session, from] of followed) {
      if (from === null || stopped) continue;
      await followLog(kernel, session, from);
    }

    if (stopped) return;
    const woke = await kernel.waits.settleFromStore();
    dev("poll", "waits", { woke });
    await settleAnswersFrom(kernel);
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
