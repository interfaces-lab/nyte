import type { Scenario } from "../scenario.ts";
import { invariant, timed } from "../scenario.ts";

/** §47f shared folds over the wire: a long session opens once; leaving and returning resumes after the last folded seq instead of replaying the log. Run under `bench:no-eval` too: the client decodes every frame with TypeBox's dynamic checker there, where an unresolved `$ref` made each frame cost milliseconds. */
export const watchReopen: Scenario = {
  name: "watch-reopen",
  guarantee:
    "Over the wire, a 5,000-message session's first view arrives in bounded time; returning to it after its watch closed transfers a few frames, not the log.",
  async run(driver) {
    const bench = await driver.open({ sessions: 1, messagesPerSession: 5_000 });
    const link = await bench.connect();
    const [info] = await link.connection.sessions.list({ limit: 1 }).then((page) => page.items);
    if (info === undefined) throw new Error("fixture made no session");
    const session = link.connection.session(info.id);

    const view = async () => {
      const before = link.received();
      const stream = session.watch()[Symbol.asyncIterator]();
      const first = await timed(() => stream.next());
      await stream.return?.();
      const messages = first.value.done ? [] : first.value.value.messages;

      return { ms: first.ms, bytes: link.received() - before, messages };
    };

    const opened = await view();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const reopened = await view();
    await link.close();
    await bench.close();
    const ids = (messages: readonly { readonly id: string }[]) =>
      messages.map((message) => message.id).join();

    return {
      name: this.name,
      invariants: [
        invariant(
          "the first view holds the default tail",
          opened.messages.length === 200,
          `${opened.messages.length} messages`,
        ),
        invariant(
          "the reopened view holds the same transcript",
          ids(reopened.messages) === ids(opened.messages),
        ),
        invariant(
          "reopening transfers under 2% of the bytes opening did",
          reopened.bytes * 50 < opened.bytes,
          `${reopened.bytes} of ${opened.bytes} bytes`,
        ),
      ],
      metrics: {
        openMs: opened.ms,
        openBytes: opened.bytes,
        reopenMs: reopened.ms,
        reopenBytes: reopened.bytes,
      },
    };
  },
};
