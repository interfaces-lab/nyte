import type { Scenario } from "../scenario.ts";
import { invariant, timed } from "../scenario.ts";

/**
 * §4 durability: a safe tool parked on a job survives a host crash; its memo
 * ran once; its recorded part came back by key; a never tool settles interrupted.
 */
export const durableToolReplay: Scenario = {
  name: "durable-tool-replay",
  guarantee: "Crash mid-wait, restart: a safe tool re-runs with memo and acquisitions replayed; a never tool is interrupted.",
  async run(driver) {
    const bench = await driver.open();
    const session = await bench.host.sessions.create();
    bench.model.script({ text: "", tokens: 0, tools: [{ name: "bench_wait_job", args: { command: "sleep 2" } }, { name: "bench_never", args: {} }], after: "done" });
    const receipt = await session.send("run both");
    await waitFor(async () => (await session.view()).execution.kind === "waiting");
    await bench.crash();
    const restart = await timed(() => bench.restart());
    const resumed = restart.value.session(session.id);
    const end = await resumed.receipt(receipt.id).settled();
    const view = await resumed.view();
    const tools = view.messages.filter((message) => message.kind === "part" && message.partKind === "tool");
    const states = tools.map((message) => (message.kind === "part" ? message.state : null));
    const safe = states.find((state) => isTool(state, "bench_wait_job"));
    const never = states.find((state) => isTool(state, "bench_never"));
    const memoRuns = bench.counters.bench_memo_runs?.() ?? -1;
    await bench.close();

    return {
      name: this.name,
      invariants: [
        invariant("the safe tool settled ok after the restart", phaseOf(safe) === "settled" && outcomeOf(safe) === "ok"),
        invariant("its memo computed exactly once across both runs", memoRuns === 1),
        invariant("the never tool settled interrupted", phaseOf(never) === "settled" && outcomeOf(never) === "interrupted"),
        invariant("the run completed", typeof end === "object" && end !== null && "kind" in end && end.kind === "completed"),
      ],
      metrics: { resumeMs: restart.ms },
    };
  },
};

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition not reached");
}

function isTool(state: unknown, name: string): boolean {
  return typeof state === "object" && state !== null && "name" in state && state.name === name;
}

function phaseOf(state: unknown): string | null {
  return typeof state === "object" && state !== null && "phase" in state && typeof state.phase === "string" ? state.phase : null;
}

function outcomeOf(state: unknown): string | null {
  if (typeof state !== "object" || state === null || !("outcome" in state)) return null;
  const outcome = state.outcome;

  return typeof outcome === "object" && outcome !== null && "kind" in outcome && typeof outcome.kind === "string" ? outcome.kind : null;
}

