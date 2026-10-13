import type { Scenario } from "../scenario.ts";
import { bytesOf, invariant, timed } from "../scenario.ts";

/** §1 sessions.watch({ limit }): a rename in a 5,000-session host pushes a bounded payload, not the directory. */
export const sessionsDirectory: Scenario = {
  name: "sessions-directory",
  guarantee:
    "sessions.watch({ limit: 50 }) yields at most 50 rows per change on a 5,000-session host; list() pages the rest.",
  async run(driver) {
    const bench = await driver.open({ sessions: 5_000, messagesPerSession: 4 });
    const first = await bench.host.sessions.list({ limit: 1 });
    const target = first.items[0];
    if (target === undefined) throw new Error("fixture made no session");
    const stream = bench.host.sessions.watch({ limit: 50 })[Symbol.asyncIterator]();
    await stream.next();
    const rename = timed(async () => {
      await bench.host.session(target.id).update({ name: "renamed" });
      return (await stream.next()).value;
    });
    const { value, ms } = await rename;
    const page = await timed(() => bench.host.sessions.list({ limit: 100 }));
    await stream.return?.();
    await bench.close();

    return {
      name: this.name,
      invariants: [
        invariant(
          "a watch yield carries at most the limit",
          Array.isArray(value) && value.length <= 50,
        ),
        invariant(
          "the renamed session is in the yield",
          Array.isArray(value) &&
            value.some((row) => row.id === target.id && row.name === "renamed"),
        ),
      ],
      metrics: { watchPayloadBytesMax: bytesOf(value), renameToYieldMs: ms, listPageMs: page.ms },
    };
  },
};
