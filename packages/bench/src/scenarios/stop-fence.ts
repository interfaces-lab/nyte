import type { Scenario } from "../scenario.ts";
import { collect, invariant, timed } from "../scenario.ts";

/** §2 Run.stop fence: stop() resolves synchronously in effect; the next yield already shows stopped; no later yield appends to that run. */
export const stopFence: Scenario = {
  name: "stop-fence",
  guarantee: "After stop() the very next view shows the run's parts failed { stopped } and no later view carries more of its text.",
  async run(driver) {
    const bench = await driver.open();
    const session = await bench.host.sessions.create();
    bench.model.script({ text: "y".repeat(5_000), tokens: 5_000 });
    const receipt = await session.send("go");
    const landed = await receipt.landed();
    if (landed.kind !== "landed" || landed.run === null) throw new Error("the send did not land on a run");
    const run = landed.run;
    await bench.model.pauseAfter(1_000);
    const lengthAtStop = textLength(await session.view());
    const stop = await timed(() => session.run(run).stop());
    bench.model.release();
    const { views } = await collect(session.watch(), (view) => view.execution.kind === "idle");
    const firstStopped = views.findIndex((view) => view.messages.some((message) => message.kind === "part" && message.status.kind === "failed" && message.status.failure.kind === "stopped"));
    const grewAfterStop = views.some((view) => textLength(view) > lengthAtStop);
    await bench.close();

    return {
      name: this.name,
      invariants: [
        invariant("the next yield after stop shows the run stopped", firstStopped === 0),
        invariant("no yield after stop carries more text for that run", !grewAfterStop),
      ],
      metrics: { stopResolveMs: stop.ms, yieldsUntilStopped: firstStopped + 1 },
    };
  },
};

function textLength(view: { readonly messages: readonly { readonly kind: string; readonly state?: unknown }[] }): number {
  return view.messages.reduce((sum, message) => {
    const state = message.kind === "part" ? message.state : null;

    return sum + (typeof state === "object" && state !== null && "markdown" in state && typeof state.markdown === "string" ? state.markdown.length : 0);
  }, 0);
}
