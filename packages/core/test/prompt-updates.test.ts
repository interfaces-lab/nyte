import { asId } from "@nyte-ai/schema";
import { getSystemMessageText } from "@nyte-ai/schema/model";
import type { Message } from "@nyte-ai/schema/model";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import type { Plugin } from "../src/index.ts";
import { fakeModels, open, testModel } from "./fake-models.ts";
import type { FakeModels, Request } from "./fake-models.ts";
import { echo } from "./turn-support.ts";

afterEach(() => {
  vi.useRealTimers();
});

const id = asId<"session">("chat");
const side = asId<"head">("side");
const RETRY = "503 Service Unavailable";

/** A plugin contributing one prompt section per entry of `sections`, read again each time it activates. */
function sectioned(sections: Map<string, { text: string; order: number }>): Plugin<"core"> {
  return {
    id: "sectioned",
    contribute: { tools: [echo] },
    activate(api) {
      for (const [section, value] of sections)
        api.contribute.prompt.add({ id: section, text: value.text, order: value.order });
    },
  };
}

/** Models whose one model reads system messages mid-conversation when `updates`. */
function models(updates: boolean): FakeModels {
  return fakeModels({
    models: [
      testModel("model", {
        provider: "test",
        ...(updates && { compat: { supportsMidConvoSystemMessages: true } }),
      }),
    ],
  });
}

/** Waits for `receipt` while moving fake time on, past every retry's backoff. */
async function finish(receipt: { settled(): Promise<unknown> }): Promise<void> {
  let done = false;
  const settled = receipt.settled().finally(() => {
    done = true;
  });

  while (!done) await vi.advanceTimersByTimeAsync(1_000);
  await settled;
}

/** What a provider caches of each message: its role and what it says. */
function shape(request: Request | undefined): readonly string[] {
  return (request?.context.messages ?? []).map(
    (message: Message) =>
      `${message.role}:${message.role === "system" ? JSON.stringify(message.sections ?? {}) : JSON.stringify(message.content)}`,
  );
}

describe("system prompt updates", () => {
  it("keeps every update sent after one commit, in order, when requests retry before the next commit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const fake = models(true);

    const sections = new Map([
      ["rules", { text: "Rule one.", order: 50 }],
      ["style", { text: "Style one.", order: 60 }],
    ]);

    await using host = await open(fake, { plugins: [sectioned(sections)] });

    const change = (section: string, text: string, order: number) => {
      sections.set(section, { text, order });
      void host.kernel.plugins.reload(id);

      return { error: RETRY };
    };

    fake.reply(
      () => change("rules", "Rule two.", 50),
      () => change("style", "Style two.", 60),
      { content: [{ type: "text", text: "Done." }] },
    );

    await finish((await host.sessions.start({ id, content: "Go." })).receipt);
    const [first, second, third] = fake.requests;

    expect(shape(second).slice(0, shape(first).length)).toEqual(shape(first));
    expect(shape(third).slice(0, shape(second).length)).toEqual(shape(second));

    expect(third?.context.messages.slice(2).map((message) => message.role)).toEqual([
      "system",
      "system",
    ]);
    expect(third?.context.messages.slice(2)).toMatchObject([
      { sections: { rules: expect.stringContaining("Rule two.") } },
      { sections: { style: expect.stringContaining("Style two.") } },
    ]);
  });

  it("keeps an update after the text an interrupted reply kept when the retry answers with tool calls alone", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const fake = models(true);
    const sections = new Map([["rules", { text: "Rule one.", order: 50 }]]);
    await using host = await open(fake, { plugins: [sectioned(sections)] });

    fake.reply(
      () => {
        sections.set("rules", { text: "Rule two.", order: 50 });
        void host.kernel.plugins.reload(id);

        return { content: [{ type: "text", text: "Half" }], error: RETRY };
      },
      { content: [{ type: "toolCall", id: "c1", name: "echo", arguments: { text: "hi" } }] },
      { content: [{ type: "text", text: "Done." }] },
    );

    await finish((await host.sessions.start({ id, content: "Go." })).receipt);
    const [, retried, after] = fake.requests;

    expect(shape(retried).map((line) => line.slice(0, line.indexOf(":")))).toEqual([
      "system",
      "user",
      "assistant",
      "system",
      "user",
    ]);
    expect(shape(after).slice(0, shape(retried).length)).toEqual(shape(retried));
  });

  it("gives a model that takes no updates the current sections in their order, a new one in its place", async () => {
    const fake = models(false);

    const sections = new Map([
      ["a", { text: "First.", order: 10 }],
      ["c", { text: "Third.", order: 30 }],
    ]);

    fake.reply(
      { content: [{ type: "text", text: "One." }] },
      { content: [{ type: "text", text: "Two." }] },
    );
    await using host = await open(fake, { plugins: [sectioned(sections)] });
    const { session, receipt } = await host.sessions.start({ id, content: "Go." });
    await receipt.settled();
    sections.set("b", { text: "Second.", order: 20 });
    await host.kernel.plugins.reload(id);
    await (await session.send("Again.")).settled();

    const systems = (fake.requests[1]?.context.messages ?? []).filter(
      (message) => message.role === "system",
    );

    const [system] = systems;
    assert(system?.role === "system");
    const text = getSystemMessageText(system);

    expect(systems).toHaveLength(1);
    expect([text.indexOf("First."), text.indexOf("Second."), text.indexOf("Third.")]).toEqual(
      [text.indexOf("First."), text.indexOf("Second."), text.indexOf("Third.")].toSorted(
        (left, right) => left - right,
      ),
    );
    expect(text.indexOf("First.")).toBeGreaterThanOrEqual(0);
  });

  it("starts a new head from the prompt its parent sent, so the shared history reads as the parent's did", async () => {
    const fake = models(true);
    const sections = new Map([["rules", { text: "Rule one.", order: 50 }]]);

    fake.reply(
      { content: [{ type: "text", text: "One." }] },
      { content: [{ type: "text", text: "Two." }] },
    );
    await using host = await open(fake, { plugins: [sectioned(sections)] });
    const { session, receipt } = await host.sessions.start({ id, content: "Go." });
    await receipt.settled();
    sections.set("rules", { text: "Rule two.", order: 50 });
    await host.kernel.plugins.reload(id);

    expect(await session.heads.create(side)).toMatchObject({ kind: "created" });
    await (await session.head(side).send("Aside.")).settled();
    const [first, branched] = fake.requests;

    expect(shape(branched).slice(0, shape(first).length)).toEqual(shape(first));
    expect(branched?.context.messages.at(-1)).toMatchObject({
      role: "system",
      sections: { rules: expect.stringContaining("Rule two.") },
    });
  });
});
