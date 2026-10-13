import type { Message } from "@nyte-ai/sdk";
import type { Scenario } from "../scenario.ts";
import { collect, invariant, percentile } from "../scenario.ts";

/**
 * §2c delta guarantees 1 and 3: a token touches one part; every other message
 * keeps identity; watch yields at most once per frame, newest wins.
 */
export const foldTokenThroughput: Scenario = {
  name: "fold-token-throughput",
  guarantee:
    "A token appends to one part and leaves every other message the same object; at most one yield per frame.",
  async run(driver) {
    const bench = await driver.open({ messagesPerSession: 200 });
    const session = await bench.host.sessions.create();
    const tokens = 10_000;
    bench.model.script({ text: "x".repeat(tokens), tokens });
    const receipt = await session.send("go");
    const landed = await receipt.landed();
    if (landed.kind !== "landed") throw new Error("the send did not land");
    const run = landed.run;
    const before = (await session.view()).messages;
    const { views, gapsMs, ms } = await collect(
      session.watch(),
      (view) => view.execution.kind === "idle" && view.execution.lastRun?.id === run,
    );
    const identityBroken = views.some((view) =>
      before.some(
        (old, index) =>
          view.messages[index] !== undefined &&
          view.messages[index] !== old &&
          view.messages[index]?.id === old.id &&
          isSettled(old),
      ),
    );
    const perTokenMs = ms / tokens;
    const yieldsPerSecond = views.length / (ms / 1000);
    await bench.close();

    return {
      name: this.name,
      invariants: [
        invariant("unchanged messages keep identity across yields", !identityBroken),
        invariant(
          "newest view wins: final text is the whole response",
          lastText(views.at(-1)?.messages ?? []).length === tokens,
        ),
      ],
      metrics: {
        tokenFoldP99Ms: percentile(gapsMs, 99) / Math.max(1, tokens / views.length),
        tokenFoldMeanMs: perTokenMs,
        yieldsPerSecondMax: yieldsPerSecond,
        yields: views.length,
      },
    };
  },
};

function isSettled(message: Message): boolean {
  return message.kind === "part"
    ? message.status.kind === "settled"
    : message.status.kind === "landed";
}

function lastText(messages: readonly Message[]): string {
  const last = messages.findLast(
    (message) => message.kind === "part" && message.partKind === "text",
  );
  const state = last !== undefined && last.kind === "part" ? last.state : null;

  return typeof state === "object" &&
    state !== null &&
    "markdown" in state &&
    typeof state.markdown === "string"
    ? state.markdown
    : "";
}
