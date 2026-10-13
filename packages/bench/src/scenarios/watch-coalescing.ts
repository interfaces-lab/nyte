import type { Scenario } from "../scenario.ts";
import { collect, invariant } from "../scenario.ts";

/** §2c guarantee 3: a burst of 10k patches yields at most once per frame; the final view is the settled text. */
export const watchCoalescing: Scenario = {
  name: "watch-coalescing",
  guarantee:
    "watch() never yields faster than a frame and never more than one pending view; the last view is complete.",
  async run(driver) {
    const bench = await driver.open();
    const session = await bench.host.sessions.create();
    bench.model.script({ text: "z".repeat(10_000), tokens: 10_000 });
    await session.send("burst");
    const { views, gapsMs, ms } = await collect(
      session.watch(),
      (view) =>
        view.execution.kind === "idle" &&
        view.messages.some((message) => message.kind === "part" && message.partKind === "text"),
    );
    const fastest = Math.min(...gapsMs.slice(1));
    await bench.close();

    return {
      name: this.name,
      invariants: [
        invariant("no two yields closer than a frame", fastest >= 12),
        invariant(
          "the final view carries the whole text",
          views
            .at(-1)
            ?.messages.some(
              (message) =>
                message.kind === "part" &&
                typeof message.state === "object" &&
                message.state !== null &&
                "markdown" in message.state &&
                message.state.markdown === "z".repeat(10_000),
            ) === true,
        ),
      ],
      metrics: {
        yieldsPerSecondMax: views.length / (ms / 1000),
        yields: views.length,
        fastestGapMs: fastest,
      },
    };
  },
};
