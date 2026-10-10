import type { Scenario } from "../scenario.ts";
import { collect, invariant } from "../scenario.ts";

/** §2 Editing: fence → move → new input, never a view with both the old tail and the new input; a child keeps working. */
export const editMidStream: Scenario = {
  name: "edit-mid-stream",
  guarantee: "send({ replace }) while streaming never shows two streams; the replaced tail leaves before the new input appears; a running child is untouched.",
  async run(driver) {
    const bench = await driver.open();
    const session = await bench.host.sessions.create();
    const child = await bench.host.sessions.create({ parent: session.id });
    bench.model.script({ text: "c".repeat(3_000), tokens: 3_000 });
    const childReceipt = await child.send("child work");
    bench.model.script({ text: "a".repeat(4_000), tokens: 4_000 });
    const first = await session.send("typo");
    await bench.model.pauseAfter(500);
    const watching = collect(session.watch(), (view) => view.messages.some((message) => message.kind === "user" && message.content === "fixed" && message.status.kind === "landed"));
    bench.model.script({ text: "b".repeat(10), tokens: 10 });
    await session.send("fixed", { replace: first.message });
    bench.model.release();
    const { views } = await watching;
    const bothAtOnce = views.some((view) => view.messages.some((message) => message.kind === "user" && message.content === "fixed") && view.messages.some((message) => message.kind === "part" && message.status.kind === "live" && message.status.run === runOf(views[0])));
    const childEnd = await childReceipt.settled();
    await bench.close();

    return {
      name: this.name,
      invariants: [
        invariant("no view holds the old live tail and the new input together", !bothAtOnce),
        invariant("the child ran to completion despite the parent's stop", childEnd.kind === "completed"),
      ],
      metrics: { viewsUntilNewInput: views.length },
    };
  },
};

function runOf(view: { readonly execution: { readonly kind: string; readonly run?: { readonly id: string } } } | undefined): string | null {
  return view?.execution.run?.id ?? null;
}
