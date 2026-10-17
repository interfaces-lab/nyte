import { describe, expect, it } from "vitest";
import { isPart, tool } from "../src/index.ts";
import { memoryStore } from "../src/store.ts";
import type { Store } from "../src/index.ts";
import { fakeModels, open } from "./fake-models.ts";
import { expireLease, main, until } from "../src/harness.ts";
import { recorder } from "./turn-support.ts";

describe("owed calls", () => {
  it("runs a response's unopened calls after a host stop in the order the response asked for them, not by call id", async () => {
    const fake = fakeModels();
    const shared = memoryStore();
    const backing = await shared.open();
    let crashed = false;

    const crashing: Store = {
      ...shared,
      async open() {
        return {
          ...backing,
          refs: {
            ...backing.refs,
            async set(updates) {
              if (crashed) throw new Error("The host stopped.");
              const outcome = await backing.refs.set(updates);
              crashed = updates.some((update) => update.name.includes("/calls/"));

              return outcome;
            },
          },
        };
      },
    };

    fake.reply(
      {
        content: [
          { type: "toolCall", id: "z", name: "echo", arguments: { text: "first" } },
          { type: "toolCall", id: "a", name: "echo", arguments: { text: "second" } },
          { type: "toolCall", id: "m", name: "echo", arguments: { text: "third" } },
        ],
      },
      { content: [{ type: "text", text: "Done." }] },
    );

    const stopped = await open(fake, { store: crashing, plugins: [recorder().plugin] });
    const { session } = await stopped.sessions.start({ content: "Go." });
    await until(() => (crashed ? true : undefined));
    await stopped.close();
    await expireLease(backing, session.id, main);

    await using host = await open(fake, { store: shared, plugins: [recorder().plugin] });

    await until(async () => {
      const { execution } = await host.session(session.id).view();

      return execution.kind === "idle" && execution.lastRun !== null ? true : undefined;
    });

    const echoed = (await host.session(session.id).view()).messages.flatMap((message) =>
      isPart(message, tool) && message.state.phase === "settled" ? [message.state.args] : [],
    );

    expect(echoed).toEqual([{ text: "first" }, { text: "second" }, { text: "third" }]);
  });
});
