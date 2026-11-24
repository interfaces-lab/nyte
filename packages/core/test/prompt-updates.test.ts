import { asId } from "@nyte-ai/schema";
import type { PromptOverride } from "@nyte-ai/schema";
import { getSystemMessageText } from "@nyte-ai/schema/model";
import type { Message } from "@nyte-ai/schema/model";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { compaction, isPart } from "../src/index.ts";
import type { Plugin, Session } from "../src/index.ts";
import { until } from "../src/harness.ts";
import { memoryStore } from "../src/store.ts";
import { createDisk, fakeProvider } from "./fake-env.ts";
import { composed, fakeModels, open, testModel } from "./fake-models.ts";
import type { Composed, FakeModels, Request } from "./fake-models.ts";
import { echo } from "./turn-support.ts";

const main = asId<"head">("main");

afterEach(() => {
  vi.useRealTimers();
});

const id = asId<"session">("chat");
const side = asId<"head">("side");
const RETRY = "503 Service Unavailable";

function sectioned(sections: Map<string, { text: string; order: number }>): Plugin<"core"> {
  return {
    id: "sectioned",
    contribute: { tools: [echo] },
    activate: () => ({
      contribute: {
        prompt: [...sections].map(([section, value]) => ({
          id: section,
          text: value.text,
          order: value.order,
        })),
      },
    }),
  };
}

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

async function finish(receipt: { settled(): Promise<unknown> }): Promise<void> {
  let done = false;
  const settled = receipt.settled().finally(() => {
    done = true;
  });

  while (!done) await vi.advanceTimersByTimeAsync(1000);
  await settled;
}

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

  it.each<{
    readonly name: string;
    readonly updates: boolean;
    readonly defaultOn?: boolean;
    readonly prompt?: PromptOverride;
    readonly systemFile?: string;
    readonly initialState?: boolean;
    readonly run: (context: {
      readonly host: Composed;
      readonly session: Session;
      readonly fake: FakeModels;
      readonly setText: (text: string) => void;
    }) => Promise<void>;
    readonly reminders: readonly string[];
    readonly system?: string;
    readonly checkRequests?: (requests: readonly (readonly string[])[]) => void;
  }>([
    {
      name: "present from the start is told once, after the first message",
      updates: false,
      initialState: true,
      async run({ session, fake }) {
        fake.reply({ content: [{ type: "text", text: "Ok." }] });
        await session.head(main).configure({ settings: { "crew.on": true } });
        await (await session.send("Again.")).settled();
      },
      reminders: ["Go.", "on", "Again."],
    },
    {
      name: "leaving the chat says its gone text",
      updates: false,
      initialState: true,
      async run({ session, fake }) {
        fake.reply({ content: [{ type: "text", text: "Ok." }] });
        await session.head(main).configure({ settings: { "crew.on": false } });
        await (await session.send("Again.")).settled();
      },
      reminders: ["Go.", "on", "Again.", "off"],
    },
    {
      name: "returning repeats its text",
      updates: true,
      initialState: true,
      async run({ session, fake }) {
        fake.reply(
          { content: [{ type: "text", text: "Ok." }] },
          { content: [{ type: "text", text: "Ok." }] },
        );
        await session.head(main).configure({ settings: { "crew.on": false } });
        await (await session.send("Again.")).settled();
        await session.head(main).configure({ settings: { "crew.on": true } });
        await (await session.send("Again.")).settled();
      },
      reminders: ["Go.", "on", "Again.", "off", "Again.", "on"],
    },
    {
      name: "never present is never mentioned",
      updates: true,
      initialState: false,
      async run({ session, fake }) {
        fake.reply({ content: [{ type: "text", text: "Ok." }] });
        await session.head(main).configure({ settings: { "crew.on": false } });
        await (await session.send("Again.")).settled();
      },
      reminders: ["Go.", "Again."],
    },
    {
      name: "a switch on by default sends its reminder on the first message without configuring it",
      updates: false,
      defaultOn: true,
      async run({ session, fake }) {
        fake.reply({ content: [{ type: "text", text: "Ok." }] });
        await (await session.send("Again.")).settled();
      },
      reminders: ["Go.", "on", "Again."],
    },
    {
      name: "changing text while present is re-told without rewriting the system prompt",
      updates: false,
      initialState: true,
      async run({ session, fake, setText }) {
        fake.reply(
          { content: [{ type: "text", text: "Ok." }] },
          { content: [{ type: "text", text: "Ok." }] },
          { content: [{ type: "text", text: "Ok." }] },
        );
        setText("Work as a larger crew.");
        await (await session.send("Again.")).settled();
        await (await session.send("Again.")).settled();
        await session.head(main).configure({ settings: { "crew.on": false } });
        await (await session.send("Again.")).settled();
      },
      reminders: ["Go.", "on", "Again.", "on:v2", "Again.", "Again.", "off"],
    },
    {
      name: "compacting the on entry while still present tells it again",
      updates: false,
      initialState: true,
      async run({ session, fake }) {
        fake.reply(
          { content: [{ type: "text", text: "Ok." }] },
          { content: [{ type: "text", text: "Earlier chat." }] },
          { content: [{ type: "text", text: "Ok." }] },
        );
        await (await session.send("Again.")).settled();
        await compactAndWait(session);
        await (await session.send("Third.")).settled();
      },
      reminders: ["summary", "Again.", "Third.", "on"],
    },
    {
      name: "turning off right after compaction removes the on entry still says its gone text",
      updates: false,
      initialState: true,
      async run({ session, fake }) {
        fake.reply(
          { content: [{ type: "text", text: "Ok." }] },
          { content: [{ type: "text", text: "Earlier chat." }] },
          { content: [{ type: "text", text: "Ok." }] },
        );
        await (await session.send("Again.")).settled();
        await compactAndWait(session);
        await session.head(main).configure({ settings: { "crew.on": false } });
        await (await session.send("Third.")).settled();
      },
      reminders: ["summary", "Again.", "Third.", "off"],
    },
    {
      name: "no orphan off after compaction removes the on and off entries",
      updates: false,
      initialState: true,
      async run({ session, fake }) {
        fake.reply(
          { content: [{ type: "text", text: "Ok." }] },
          { content: [{ type: "text", text: "Ok." }] },
          { content: [{ type: "text", text: "Earlier chat." }] },
          { content: [{ type: "text", text: "Ok." }] },
        );
        await session.head(main).configure({ settings: { "crew.on": false } });
        await (await session.send("Second.")).settled();
        await (await session.send("Third.")).settled();
        await compactAndWait(session);
        await (await session.send("Fourth.")).settled();
      },
      reminders: ["summary", "Third.", "Fourth."],
      checkRequests(requests) {
        expect(requests[0]).toEqual(["Go.", "on"]);
        expect(requests[1]).toEqual(["Go.", "on", "Second.", "off"]);
      },
    },
    {
      name: "a replace prompt override does not swallow reminders",
      updates: false,
      initialState: true,
      prompt: { kind: "replace", text: "Only this system prompt." },
      async run() {},
      reminders: ["Go.", "on"],
      system: "Only this system prompt.",
    },
    {
      name: "SYSTEM.md does not swallow reminders",
      updates: false,
      initialState: true,
      systemFile: "From SYSTEM.md.",
      async run() {},
      reminders: ["Go.", "on"],
      system: "From SYSTEM.md.",
    },
    {
      name: "unloading a plugin while its reminder section was present says its gone text from the record",
      updates: false,
      initialState: true,
      async run({ host, session, fake }) {
        fake.reply(
          { content: [{ type: "text", text: "Ok." }] },
          { content: [{ type: "text", text: "Ok." }] },
        );
        await host.plugins.replace([], { session: session.id });
        await (await session.send("Again.")).settled();
        await (await session.send("Third.")).settled();
      },
      reminders: ["Go.", "on", "Again.", "off", "Third."],
    },
  ])(
    "reminder sections: $name",
    async ({
      updates,
      defaultOn,
      prompt,
      systemFile,
      initialState,
      run,
      reminders,
      system,
      checkRequests,
    }) => {
      const fake = models(updates);
      fake.reply({ content: [{ type: "text", text: "Ok." }] });
      let currentText = "Work as a crew.";

      const crew: Plugin<"core"> = {
        id: "crew",
        contribute: {
          settings: [
            {
              id: "crew.on",
              title: "Crew",
              type: "switch",
              scope: "chat",
              ...(defaultOn === true ? { default: true } : {}),
            },
          ],
          prompt: [
            {
              id: "crew",
              delivery: "reminder",
              when: (chat) => chat.settings["crew.on"] === true,
              text: () => `Crew instructions.\n\n${currentText}`,
              gone: "Crew instructions no longer apply.",
            },
          ],
        },
      };

      const disk = systemFile === undefined ? null : createDisk();
      disk?.put("/work/.nyte/SYSTEM.md", systemFile ?? "");

      await using host =
        disk === null
          ? await open(fake, { plugins: [crew] })
          : await composed({
              store: memoryStore(),
              models: fake.models,
              plugins: [{ id: "local", environment: fakeProvider(disk) }, crew],
              workspace: { kind: "local", path: "/work" },
              home: null,
              description: { name: "test", platform: "darwin", version: "0.1.0" },
            });

      if (disk !== null) {
        const [workspace] = await host.workspaces.list();
        assert(workspace !== undefined);
        await host.workspace(workspace.id).update({ trusted: true });
      }

      const { session, receipt } = await host.sessions.start({
        id,
        content: "Go.",
        ...(prompt !== undefined ? { prompt } : {}),
        ...(initialState !== undefined
          ? { configuration: { settings: { "crew.on": initialState } } }
          : {}),
      });
      await receipt.settled();

      await run({
        host,
        session,
        fake,
        setText(next) {
          currentText = next;
        },
      });

      const told = (message: Message): string => {
        const text = typeof message.content === "string" ? message.content : "";

        if (
          text === "<system-reminder>\nCrew instructions.\n\nWork as a crew.\n</system-reminder>"
        ) {
          return "on";
        }

        if (
          text ===
          "<system-reminder>\nCrew instructions.\n\nWork as a larger crew.\n</system-reminder>"
        ) {
          return "on:v2";
        }

        if (text === "<system-reminder>\nCrew instructions no longer apply.\n</system-reminder>") {
          return "off";
        }

        if (text.startsWith("The earlier conversation was summarised")) return "summary";

        return text;
      };

      const chatRequests = fake.requests
        .map((request) => request.context.messages)
        .filter((messages) => messages[0]?.role === "system" && messages[0].content === "");

      const userTurns = chatRequests.map((messages) =>
        messages.filter((message) => message.role === "user").map(told),
      );

      checkRequests?.(userTurns);
      expect(userTurns.at(-1)).toEqual(reminders);
      expect(new Set(chatRequests.map((messages) => JSON.stringify(messages[0])))).toHaveProperty(
        "size",
        1,
      );

      if (system !== undefined) {
        const firstSystem = chatRequests[0]?.[0];
        assert(firstSystem?.role === "system");
        expect(getSystemMessageText(firstSystem)).toBe(system);
      }
    },
  );
});

async function compactAndWait(session: Session): Promise<void> {
  expect(await session.compact()).toMatchObject({ kind: "started" });
  await until(async () =>
    (await session.view()).messages.some(
      (message) => isPart(message, compaction) && message.status.kind === "settled",
    )
      ? true
      : undefined,
  );
}
