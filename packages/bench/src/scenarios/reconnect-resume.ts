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
    const watching = collect(session.watch(), (view) => view.messages.filter((message) => message.kind === "user").length === 2 && view.execution.kind === "idle");
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
    const seqs = views.map((view) => view.revision);
    const monotone = seqs.every((seq, index) => index === 0 || seq !== seqs[index - 1]);
    await link.close();
    await bench.close();

    return {
      name: this.name,
      invariants: [
        invariant("the offline send landed exactly once", userCount === 2),
        invariant("views after resume never repeat a revision", monotone),
        invariant("the stream text is complete after resume", final?.messages.some((message) => message.kind === "part" && typeof message.state === "object" && message.state !== null && "markdown" in message.state && message.state.markdown === "r".repeat(6_000)) === true),
      ],
      metrics: { resumeMs: ms - 300 },
    };
  },
};
