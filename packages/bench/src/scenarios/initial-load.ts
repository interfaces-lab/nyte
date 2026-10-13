import type { Scenario } from "../scenario.ts";
import { bytesOf, invariant, timed } from "../scenario.ts";

/** §2c ViewOptions.tail and history(): a long session opens bounded, pages back without gaps or repeats. */
export const initialLoad: Scenario = {
  name: "initial-load",
  guarantee:
    "view({ tail }) is bounded for a 5,000-message session; history() pages back and reassembles the whole transcript once.",
  async run(driver) {
    const bench = await driver.open({ sessions: 1, messagesPerSession: 5_000 });
    const [info] = await bench.host.sessions.list({ limit: 1 }).then((page) => page.items);
    if (info === undefined) throw new Error("fixture made no session");
    const session = bench.host.session(info.id);
    const tail = await timed(() => session.view({ tail: 200 }));
    const seen = [...tail.value.messages];
    const pageTimes: number[] = [];
    let before = seen[0]?.id;

    while (before !== undefined) {
      const page = await timed(() => session.history({ before, limit: 200 }));
      pageTimes.push(page.ms);
      if (page.value.length === 0) break;
      seen.unshift(...page.value);
      before = page.value[0]?.id;
    }

    const ids = seen.map((message) => message.id);
    const whole = await session.view({ tail: Number.MAX_SAFE_INTEGER });
    await bench.close();

    return {
      name: this.name,
      invariants: [
        invariant("tail is exactly 200", tail.value.messages.length === 200),
        invariant(
          "pages reassemble the transcript in order with no repeats",
          ids.length === new Set(ids).size &&
            ids.join() === whole.messages.map((message) => message.id).join(),
        ),
      ],
      metrics: {
        viewTailMs: tail.ms,
        viewTailBytes: bytesOf(tail.value),
        historyPageMs: Math.max(...pageTimes),
        pages: pageTimes.length,
      },
    };
  },
};
