import { asId } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import { isPart, text, tool } from "../src/index.ts";
import { decodeRunRecord, runRef } from "../src/store.ts";
import { fakeModels, open } from "./fake-models.ts";
import { label, until } from "../src/harness.ts";
import { events, landedRun, recorder, sent } from "./turn-support.ts";

const CONTINUE =
  "user:The previous response was interrupted. Continue from where you left off without repeating completed content.";

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

describe("pause", () => {
  it("ends the stream in flight and holds the run, counting no interruption, until resume continues it from the kept text", async () => {
    const fake = fakeModels();

    fake.reply(
      { content: [{ type: "text", text: "A partial answer" }], hold: true },
      { content: [{ type: "text", text: "l answer" }] },
    );

    await using host = await open(fake);
    const id = asId<"session">("chat");
    const logged = events(host.kernel, id);
    const { session, receipt } = await host.sessions.start({ id, content: "Go." });

    await until(async () =>
      (await session.view()).messages.some(
        (message) =>
          isPart(message, text) && message.status.kind === "live" && message.state.markdown !== "",
      )
        ? true
        : undefined,
    );

    host.execution.pause();
    await until(() => (logged.some((event) => label(event) === "run:retrying") ? true : undefined));
    await settle();

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].options?.signal?.aborted).toBe(true);

    const paused = await session.view();
    const run = landedRun(paused.messages);
    const ref = await host.kernel.store.refs.get(runRef(id, run));

    assert(ref?.target);
    const record = decodeRunRecord(await host.kernel.store.objects.get(ref.target));

    assert(record !== null);

    expect(record.interrupted).toBeUndefined();
    expect(record.retrying).toMatchObject({
      reason: "The response was interrupted before it finished.",
    });
    expect(paused.execution.kind).toBe("retrying");

    host.execution.resume();

    expect((await receipt.settled()).kind).toBe("completed");
    expect(fake.requests).toHaveLength(2);
    expect(sent(fake, 1)).toEqual(["system", "user:Go.", "assistant:A partia", CONTINUE]);
  });

  it("holds back the first request of a run that starts while paused", async () => {
    const fake = fakeModels();
    fake.reply({ content: [{ type: "text", text: "Done." }] });
    await using host = await open(fake);

    host.execution.pause();
    host.execution.pause();
    const { session, receipt } = await host.sessions.start({ content: "Go." });
    await until(async () => ((await session.view()).execution.kind === "live" ? true : undefined));
    await settle();

    expect(fake.requests).toHaveLength(0);

    host.execution.resume();
    host.execution.resume();

    expect((await receipt.settled()).kind).toBe("completed");
    expect(fake.requests).toHaveLength(1);
  });

  it("lets a running tool finish and holds the request after it", async () => {
    const fake = fakeModels();
    const gate = Promise.withResolvers<void>();
    const { plugin } = recorder(gate.promise);

    fake.reply(
      { content: [{ type: "toolCall", id: "call-1", name: "wait", arguments: {} }] },
      { content: [{ type: "text", text: "Done." }] },
    );

    await using host = await open(fake, { plugins: [plugin] });
    const { session, receipt } = await host.sessions.start({ content: "Go." });

    const running = (): Promise<true | undefined> =>
      session
        .view()
        .then((view) =>
          view.messages.some((message) => isPart(message, tool) && message.status.kind === "live")
            ? true
            : undefined,
        );

    await until(running);
    host.execution.pause();
    gate.resolve();

    const settled = await until(async () =>
      (await session.view()).messages.find((message) =>
        isPart(message, tool) && message.state.phase === "settled" ? true : undefined,
      ),
    );

    await settle();

    expect(settled).toMatchObject({ state: { outcome: { kind: "ok" } } });
    expect(fake.requests).toHaveLength(1);

    host.execution.resume();

    expect((await receipt.settled()).kind).toBe("completed");
    expect(fake.requests).toHaveLength(2);
  });
});
