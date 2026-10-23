import { asId, isJsonObject } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { isPart, text } from "../src/index.ts";
import { decodePartRecord, leaseRef, memoryStore, partRef } from "../src/store.ts";
import { fakeModels, open } from "./fake-models.ts";
import { label, main, until } from "../src/harness.ts";
import { events, landedRun, sent, settledText } from "./turn-support.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("continuing a cut-off response", () => {
  it("continues a response cut off after it streamed text: the text settles, its thinking fails, and one request asks the model to go on", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const fake = fakeModels();

    fake.reply(
      {
        content: [
          { type: "thinking", thinking: "Plan it.", signature: "sig-1" },
          { type: "text", text: "First half" },
        ],
        error: "503 Service Unavailable",
      },
      { content: [{ type: "text", text: " and the rest." }] },
      { content: [{ type: "text", text: "Sure." }] },
    );

    await using host = await open(fake);
    const id = asId<"session">("chat");
    const logged = events(host.kernel, id);
    const { session, receipt } = await host.sessions.start({ id, content: "Go." });

    await until(() => (logged.some((event) => label(event) === "run:retrying") ? true : undefined));
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await receipt.settled()).kind).toBe("completed");

    const view = await session.view();
    const run = landedRun(view.messages);

    expect(view.messages.filter((message) => message.kind === "part")).toMatchObject([
      { id: `${run}:a1:1`, state: { markdown: "First half" }, status: { kind: "settled" } },
      { id: `${run}:a2:0`, state: { markdown: " and the rest." }, status: { kind: "settled" } },
    ]);

    const thought = await host.kernel.store.refs.get(partRef(id, asId(`${run}:a1:0`)));

    assert(thought?.target);
    expect(decodePartRecord(await host.kernel.store.objects.get(thought.target))).toMatchObject({
      state: { markdown: "Plan it." },
      status: { kind: "failed", failure: { class: "overloaded" } },
    });

    const instruction =
      "user:The previous response was interrupted. Continue from where you left off without repeating completed content.";

    expect(fake.requests).toHaveLength(2);
    expect(sent(fake, 1)).toEqual(["system", "user:Go.", "assistant:First half", instruction]);

    expect((await (await session.send("Thanks.")).settled()).kind).toBe("completed");
    expect(sent(fake, 2)).toEqual([
      "system",
      "user:Go.",
      "assistant:First half",
      instruction,
      "assistant: and the rest.",
      "user:Thanks.",
    ]);
  });

  it("continues from the text a host saved when it stopped mid-stream, on the host that takes the run over", async () => {
    const fake = fakeModels();
    const shared = memoryStore();
    const id = asId<"session">("chat");

    fake.reply(
      { content: [{ type: "text", text: "A partial answer" }], hold: true },
      { content: [{ type: "text", text: "l answer" }] },
    );

    const first = await open(fake, { store: shared });
    await first.sessions.start({ id, content: "Go." });

    const live = await until(async () =>
      (await first.session(id).view()).messages
        .flatMap((message) =>
          isPart(message, text) && message.status.kind === "live" && message.state.markdown !== ""
            ? [message.part]
            : [],
        )
        .at(0),
    );

    await first.close();
    const store = await shared.open();

    await until(async () => {
      const target = (await store.refs.get(partRef(id, live)))?.target;
      const saved = target ? decodePartRecord(await store.objects.get(target))?.state : null;

      return isJsonObject(saved) && saved.markdown === "A partia" ? true : undefined;
    });
    await store.refs.set([{ name: leaseRef(id, main), target: null }]);

    await using host = await open(fake, { store: shared });

    const ended = await until(async () => {
      const { execution } = await host.session(id).view();

      return execution.kind === "idle" && execution.lastRun !== null
        ? execution.lastRun
        : undefined;
    });

    expect(ended.end.kind).toBe("completed");
    expect(settledText((await host.session(id).view()).messages)).toEqual(["A partia", "l answer"]);
    expect(sent(fake, 1)).toEqual([
      "system",
      "user:Go.",
      "assistant:A partia",
      "user:The previous response was interrupted. Continue from where you left off without repeating completed content.",
    ]);
  });
});
