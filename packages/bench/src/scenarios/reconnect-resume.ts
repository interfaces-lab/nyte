import type { Scenario } from "../scenario.ts";
import { collect, invariant, timed } from "../scenario.ts";

/** §1 connect: link loss resumes watches from seq and resends journaled sends by id; nothing missed, nothing doubled. */
export const reconnectResume: Scenario = {
  name: "reconnect-resume",
  guarantee: "Drop the socket mid-stream: the watch resumes with no gap or repeat; a send made while down lands exactly once.",
  async run(driver) {
    const bench = await driver.open();
    const link = await bench.connect();
    const session = await link.connection.sessions.create();
    bench.model.script({ text: "r".repeat(6_000), tokens: 6_000 });
    await session.send("stream");
    await bench.model.pauseAfter(2_000);
    const stream = session.watch()[Symbol.asyncIterator]();
    const watch = { [Symbol.asyncIterator]: () => ({ next: () => stream.next() }) };
    const watching = collect(watch, (view) => view.messages.filter((message) => message.kind === "user").length === 2 && view.execution.kind === "idle");
    link.drop();
    const sendWhileDown = session.send("queued while offline", { delivery: "queue" });
    const reconnect = timed(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      link.restore();
      await sendWhileDown;
    });
    bench.model.release();
    const { views } = await watching;
    const { ms } = await reconnect;
    const final = views.at(-1);
    const userCount = final?.messages.filter((message) => message.kind === "user").length ?? 0;
    const tail = await (await bench.store.open()).refs.tail(session.id);
    const rest = await Promise.race([collect(watch, (view) => view.seq >= tail), new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000))]);
    await stream.return?.();
    const seqs = [...views, ...(rest?.views ?? [])].map((view) => view.seq);
    const ordered = seqs.every((seq, index) => index === 0 || seq >= seqs[index - 1]);
    await link.close();
    await bench.close();

    return {
      name: this.name,
      invariants: [
        invariant("the offline send landed exactly once", userCount === 2),
        invariant("no durable event repeats or reorders after resume: view seqs never fall", ordered),
        invariant("no durable event is missed after resume: a view folds the log's tail", (seqs.at(-1) ?? 0) >= tail),
        invariant("the stream text is complete after resume", final?.messages.some((message) => message.kind === "part" && typeof message.state === "object" && message.state !== null && "markdown" in message.state && message.state.markdown === "r".repeat(6_000)) === true),
      ],
      metrics: { resumeMs: ms - 300 },
    };
  },
};
