import { describe, expect, it } from "vitest";
import { isPart, text, watchStore } from "../src/index.ts";
import type { Head } from "../src/index.ts";
import { until } from "../src/harness.ts";
import { fakeModels, open, testModel } from "./fake-models.ts";

function answers(head: Head): readonly string[] | undefined {
  const view = head.current();

  return view?.messages.flatMap((message) =>
    isPart(message, text) ? [message.state.markdown] : [],
  );
}

describe("a head as a store", () => {
  it("hands every subscriber the latest view", async () => {
    const fake = fakeModels({ models: [testModel("model")] });
    fake.reply({ content: [{ type: "text", text: "Hello there" }] });
    await using host = await open(fake);
    const { session, receipt } = await host.sessions.start({ content: "Hi." });
    let calls = 0;
    const unsubscribe = session.subscribe(() => (calls += 1));

    await receipt.settled();
    await until(() => (answers(session)?.includes("Hello there") ? true : undefined));
    unsubscribe();

    expect(calls).toBeGreaterThan(0);
    expect(session.current()?.messages.map((message) => message.kind)).toEqual(["user", "part"]);
  });

  it("stops delivering once the last listener leaves, and resumes on the next", async () => {
    const fake = fakeModels({ models: [testModel("model")] });
    fake.reply(
      { content: [{ type: "text", text: "First" }] },
      { content: [{ type: "text", text: "Second" }] },
    );
    await using host = await open(fake);
    const { session, receipt } = await host.sessions.start({ content: "One." });
    let calls = 0;
    const unsubscribe = session.subscribe(() => (calls += 1));

    await receipt.settled();
    await until(() => (answers(session)?.includes("First") ? true : undefined));
    unsubscribe();
    const seen = calls;

    await (await session.send("Two.")).settled();

    for await (const view of session.watch()) {
      if (
        view.messages.some(
          (message) => isPart(message, text) && message.state.markdown === "Second",
        )
      )
        break;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(calls).toBe(seen);
    expect(answers(session)).toEqual(["First"]);

    const again = session.subscribe(() => undefined);

    await until(() => (answers(session)?.includes("Second") ? true : undefined));
    again();

    expect(answers(session)).toEqual(["First", "Second"]);
  });
});

describe("watchStore", () => {
  it("throws the watch's failure from current until a new first listener opens another", async () => {
    let opened = 0;

    const store = watchStore<number>(() => {
      opened += 1;

      return (async function* () {
        yield opened;
        throw new Error(`watch ${opened} failed`);
      })();
    });

    const leave = store.subscribe(() => undefined);

    await until(() => {
      try {
        store.current();

        return undefined;
      } catch (error) {
        return error;
      }
    });

    expect(() => store.current()).toThrow("watch 1 failed");
    leave();

    const again = store.subscribe(() => undefined);

    expect(store.current()).toBe(1);
    await until(() => (opened === 2 ? true : undefined));
    again();
    expect(opened).toBe(2);
  });

  it("closes the watch when its last listener leaves", async () => {
    let closed = false;

    const store = watchStore<string>(() => ({
      [Symbol.asyncIterator]() {
        let delivered = false;

        return {
          next(): Promise<IteratorResult<string>> {
            if (delivered) return new Promise(() => undefined);
            delivered = true;

            return Promise.resolve({ done: false, value: "view" });
          },
          async return(): Promise<IteratorResult<string>> {
            closed = true;

            return { done: true, value: undefined };
          },
        };
      },
    }));

    const leave = store.subscribe(() => undefined);

    await until(() => store.current());
    expect(closed).toBe(false);
    leave();

    expect(closed).toBe(true);
    expect(store.current()).toBe("view");
  });

  it("keeps one watch however many listeners share it", async () => {
    let opened = 0;

    const store = watchStore<string>(() => {
      opened += 1;

      return (async function* () {
        yield "view";
      })();
    });

    const first = store.subscribe(() => undefined);
    const second = store.subscribe(() => undefined);

    await until(() => store.current());
    first();
    second();

    expect(opened).toBe(1);
    expect(store.current()).toBe("view");
  });
});
