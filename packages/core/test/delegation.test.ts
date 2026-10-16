import { asId } from "@nyte-ai/schema";
import type { Message } from "@nyte-ai/schema";
import { contentText } from "@nyte-ai/schema/model";
import { assert, describe, expect, it } from "vitest";
import { isPart, tool } from "../src/index.ts";
import { fakeModels, open } from "./fake-models.ts";
import type { Reply, Request } from "./fake-models.ts";
import { until } from "../src/harness.ts";

function settledCall(messages: readonly Message[], call: string) {
  const found = messages.find(
    (message) => isPart(message, tool) && message.state.call.endsWith(`:${call}`),
  );

  assert(found !== undefined && isPart(found, tool) && found.state.phase === "settled");

  return found.state;
}

function lastResult(request: Request | undefined): string {
  const result = request?.context.messages.findLast((message) => message.role === "toolResult");
  assert(result?.role === "toolResult");

  return result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

describe("delegation", () => {
  it("runs task in a child, waits for it, and resumes the parent with its answer", async () => {
    const fake = fakeModels();
    let release = () => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    fake.reply(
      {
        content: [
          {
            type: "toolCall",
            id: "call-task",
            name: "task",
            arguments: { prompt: "Find the answer.", title: "Finder" },
          },
        ],
      },
      { content: [{ type: "text", text: "The answer is 42." }], until: gate },
      { content: [{ type: "text", text: "The child found 42." }] },
    );

    await using host = await open(fake);
    const parent = await host.sessions.create();
    const receipt = await parent.send("Delegate it.");

    await until(async () => {
      const execution = (await parent.view()).execution;

      return execution.kind === "waiting" && execution.on.kind === "run" ? true : undefined;
    });

    release();
    const end = await receipt.settled();

    expect(end.kind).toBe("completed");
    expect(fake.requests).toHaveLength(3);
    expect(fake.requests[1].options?.sessionId).not.toBe(parent.id);

    const children = await host.sessions.list({
      parents: { kind: "children", session: parent.id },
    });

    const child = children.items[0];

    expect(children.items).toHaveLength(1);
    expect(child).toMatchObject({ parent: parent.id, name: "Finder" });
    expect(fake.requests[1].options?.sessionId).toBe(child.id);

    const report = lastResult(fake.requests[2]);

    expect(report).toBe(`Subagent ${child.id} finished.\n\nThe answer is 42.`);

    const view = await parent.view();
    const state = settledCall(view.messages, "call-task");

    expect(state.class).toEqual({ kind: "delegate", child: null, role: "task", title: "Finder" });
    expect(state.outcome).toMatchObject({ kind: "ok", content: [{ kind: "text", text: report }] });
    expect(
      view.messages.filter((message) => message.kind === "user" && message.source.kind === "child"),
    ).toHaveLength(0);
    expect(view.messages.at(-1)).toMatchObject({
      kind: "part",
      state: { markdown: "The child found 42." },
    });
  });

  it("creates a child with a role, sends to it, and awaits its answer", async () => {
    const fake = fakeModels();
    let release = () => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await using host = await open(fake);
    const parent = await host.sessions.create();
    let child = "";

    const parentScript: readonly ((request: Request) => Reply)[] = [
      () => ({
        content: [
          {
            type: "toolCall",
            id: "call-create",
            name: "create",
            arguments: { title: "Counter", role: "You count." },
          },
        ],
      }),
      (request) => {
        child = /Created subagent (\S+)\./.exec(lastResult(request))?.[1] ?? "";

        return {
          content: [
            {
              type: "toolCall",
              id: "call-send",
              name: "send",
              arguments: { session: child, prompt: "Count to two." },
            },
          ],
        };
      },
      () => ({
        content: [
          { type: "toolCall", id: "call-await", name: "await", arguments: { session: child } },
        ],
      }),
      () => ({ content: [{ type: "text", text: "It counted." }] }),
    ];

    const childScript: readonly ((request: Request) => Reply)[] = [
      () => ({ content: [{ type: "text", text: "One, two." }], until: gate }),
    ];

    let parentTurn = 0;
    let childTurn = 0;

    const dispatch = (request: Request): Reply => {
      const script = request.options?.sessionId === parent.id ? parentScript : childScript;
      const index = script === parentScript ? parentTurn++ : childTurn++;

      return script[index]?.(request) ?? { error: "Nothing more was scripted." };
    };

    fake.reply(dispatch, dispatch, dispatch, dispatch, dispatch);
    const receipt = await parent.send("Get it counted.");

    await until(async () => {
      const execution = (await parent.view()).execution;

      return execution.kind === "waiting" ? true : undefined;
    });

    release();
    expect(await receipt.settled()).toMatchObject({ kind: "completed" });

    const messages = (await parent.view()).messages;

    expect(settledCall(messages, "call-send").outcome).toMatchObject({
      kind: "ok",
      content: [{ kind: "text", text: expect.stringMatching(/^Sent to subagent .+; /) }],
    });
    expect(settledCall(messages, "call-await").outcome).toMatchObject({
      kind: "ok",
      content: [{ kind: "text", text: `Subagent ${child} finished.\n\nOne, two.` }],
    });

    const childRequest = fake.requests.find((request) => request.options?.sessionId === child);
    const system = childRequest?.context.messages[0];

    assert(system?.role === "system");
    expect(contentText(system.content)).toContain("<0100-session>\nYou count.\n</0100-session>");
    expect((await host.session(asId(child)).info()).name).toBe("Counter");
  });

  it("reads a child's conversation with read_agent", async () => {
    const fake = fakeModels();
    fake.reply({ content: [{ type: "text", text: "Hi from the child." }] });
    await using host = await open(fake);
    const parent = await host.sessions.create();
    const child = await host.sessions.create({ parent: parent.id });
    await (await child.send("Hello child.")).settled();

    fake.reply(
      {
        content: [
          {
            type: "toolCall",
            id: "call-read",
            name: "read_agent",
            arguments: { session: child.id },
          },
        ],
      },
      { content: [{ type: "text", text: "Read it." }] },
    );

    await (await parent.send("What did it say?")).settled();

    expect(lastResult(fake.requests[2])).toBe(
      `Subagent ${child.id} is idle.\n\nUser: Hello child.\n\nAssistant: Hi from the child.`,
    );
  });

  it("fails a call naming a session that is not its child", async () => {
    const fake = fakeModels();
    await using host = await open(fake);
    const parent = await host.sessions.create();
    const stranger = await host.sessions.create();

    fake.reply(
      {
        content: [
          {
            type: "toolCall",
            id: "call-read",
            name: "read_agent",
            arguments: { session: stranger.id },
          },
        ],
      },
      { content: [{ type: "text", text: "Could not." }] },
    );

    await (await parent.send("Read it.")).settled();
    const state = settledCall((await parent.view()).messages, "call-read");

    expect(state.outcome).toEqual({
      kind: "failed",
      message: `Session ${stranger.id} is not a subagent of this session.`,
    });
  });

  it("stops a child's live run with stop", async () => {
    const fake = fakeModels();
    fake.reply({ content: [{ type: "text", text: "Working on it forever" }], hold: true });
    await using host = await open(fake);
    const parent = await host.sessions.create();
    const child = await host.sessions.create({ parent: parent.id });
    const working = await child.send("Work.");

    await until(async () =>
      (await child.view()).execution.kind === "live" && fake.requests.length === 1
        ? true
        : undefined,
    );

    fake.reply(
      {
        content: [
          { type: "toolCall", id: "call-stop", name: "stop", arguments: { session: child.id } },
        ],
      },
      { content: [{ type: "text", text: "Stopped it." }] },
    );

    await (await parent.send("Stop the child.")).settled();

    expect(await working.settled()).toEqual({ kind: "stopped" });
    expect(lastResult(fake.requests[2])).toBe(
      `Stopped 1 run of subagent ${child.id} and withdrew 0 pending messages.`,
    );
    expect(settledCall((await parent.view()).messages, "call-stop").class).toEqual({
      kind: "delegate",
      child: child.id,
      role: "stop",
      title: null,
    });
  });
});
