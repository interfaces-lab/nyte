import { isPart, text, tool } from "@nyte-ai/core";
import type { Plugin } from "@nyte-ai/core";
import { composeHost } from "@nyte-ai/core/server";
import { memoryStore } from "@nyte-ai/core/store";
import subagents from "@nyte-ai/plugin/core/subagents";
import { asId } from "@nyte-ai/schema";
import type { Message, WorkspaceTarget } from "@nyte-ai/schema";
import { contentText } from "@nyte-ai/schema/model";
import { assert, describe, expect, it } from "vitest";
import { env, fakeModels, open, until } from "./fake-models.ts";
import type { Reply, Request } from "./fake-models.ts";

function locate(target: WorkspaceTarget): string {
  return "locator" in target ? JSON.stringify(target.locator) : target.path;
}

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

describe("subagents", () => {
  it("runs task in a child, waits for it, and resumes the parent with its answer", async () => {
    const fake = fakeModels();
    const gate = Promise.withResolvers<void>();

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
      { content: [{ type: "text", text: "The answer is 42." }], until: gate.promise },
      { content: [{ type: "text", text: "The child found 42." }] },
    );

    await using host = await open(fake, [subagents]);
    const { session: parent, receipt } = await host.sessions.start({
      content: "Delegate it.",
    });

    await until(async () => {
      const execution = (await parent.view()).execution;

      return execution.kind === "waiting" && execution.on.kind === "run" ? true : undefined;
    });

    gate.resolve();
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

  it("returns task when the user writes, so the parent answers while the child keeps working", async () => {
    const fake = fakeModels();
    const gate = Promise.withResolvers<void>();

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
      { content: [{ type: "text", text: "Halfway." }], until: gate.promise },
      { content: [{ type: "text", text: "Still on it." }] },
      { content: [{ type: "text", text: "It found it." }] },
    );

    await using host = await open(fake, [subagents]);
    const { session: parent } = await host.sessions.start({ content: "Delegate it." });

    const child = await until(async () => {
      const execution = (await parent.view()).execution;

      if (execution.kind !== "waiting" || execution.on.kind !== "run") return undefined;

      const found = host.session(execution.on.session);
      const streamed = (await found.view()).messages.some(
        (message) => isPart(message, text) && message.state.markdown === "Halfway.",
      );

      return streamed ? found : undefined;
    });

    await parent.send("How is it going?");
    await until(() => (fake.requests.length === 3 ? true : undefined));

    expect(lastResult(fake.requests[2])).toBe(`Subagent ${child.id} is still working.\n\nHalfway.`);
    expect(fake.requests[2].context.messages.at(-1)).toMatchObject({
      role: "user",
      content: "How is it going?",
    });

    gate.resolve();
    await until(() => (fake.requests.length === 4 ? true : undefined));

    expect(fake.requests[3].context.messages.at(-1)).toMatchObject({
      role: "user",
      content: `Child ${child.id} completed:\n\nHalfway.`,
    });
  });

  it("creates a child with a role and a first message, awaits its answer, and sends to it", async () => {
    const fake = fakeModels();
    const gate = Promise.withResolvers<void>();

    await using host = await open(fake, [subagents]);
    const parent = asId<"session">("parent");
    let child = "";

    const parentScript: readonly ((request: Request) => Reply)[] = [
      () => ({
        content: [
          {
            type: "toolCall",
            id: "call-create",
            name: "create",
            arguments: { title: "Counter", role: "You count.", prompt: "Count to two." },
          },
        ],
      }),
      (request) => {
        child = /Started subagent (\S+)\./.exec(lastResult(request))?.[1] ?? "";

        return {
          content: [
            { type: "toolCall", id: "call-await", name: "await", arguments: { session: child } },
          ],
        };
      },
      () => ({
        content: [
          {
            type: "toolCall",
            id: "call-send",
            name: "send",
            arguments: { session: child, prompt: "Count to three." },
          },
        ],
      }),
      () => ({ content: [{ type: "text", text: "It counted." }] }),
    ];

    const childScript: readonly ((request: Request) => Reply)[] = [
      () => ({ content: [{ type: "text", text: "One, two." }], until: gate.promise }),
      () => ({ content: [{ type: "text", text: "One, two, three." }] }),
    ];

    let parentTurn = 0;
    let childTurn = 0;

    const dispatch = (request: Request): Reply => {
      const script = request.options?.sessionId === parent ? parentScript : childScript;
      const index = script === parentScript ? parentTurn++ : childTurn++;

      return script[index]?.(request) ?? { error: "Nothing more was scripted." };
    };

    fake.reply(dispatch, dispatch, dispatch, dispatch, dispatch, dispatch);
    const { receipt } = await host.sessions.start({ id: parent, content: "Get it counted." });

    await until(async () => {
      const execution = (await host.session(parent).view()).execution;

      return execution.kind === "waiting" ? true : undefined;
    });

    gate.resolve();
    expect(await receipt.settled()).toMatchObject({ kind: "completed" });

    const messages = (await host.session(parent).view()).messages;

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
    fake.reply(
      { content: [{ type: "text", text: "Ready." }] },
      { content: [{ type: "text", text: "Hi from the child." }] },
    );
    await using host = await open(fake, [subagents]);
    const { session: parent, receipt: ready } = await host.sessions.start({ content: "Hi." });
    await ready.settled();
    const { session: child, receipt: started } = await host.sessions.start({
      parent: parent.id,
      content: "Hello child.",
    });
    await started.settled();

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

    expect(lastResult(fake.requests[3])).toBe(
      `Subagent ${child.id} is idle.\n\nUser: Hello child.\n\nAssistant: Hi from the child.`,
    );
  });

  it("fails a call naming a session that is not its child", async () => {
    const fake = fakeModels();
    await using host = await open(fake, [subagents]);
    fake.reply({ content: [{ type: "text", text: "Hello." }] });
    const { session: stranger, receipt: greeted } = await host.sessions.start({ content: "Hi." });
    await greeted.settled();

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

    const { session: parent, receipt: read } = await host.sessions.start({ content: "Read it." });
    await read.settled();
    const state = settledCall((await parent.view()).messages, "call-read");

    expect(state.outcome).toEqual({
      kind: "failed",
      message: `Session ${stranger.id} is not a subagent of this session.`,
    });
  });

  it("stops a child's live run with stop", async () => {
    const fake = fakeModels();
    fake.reply({ content: [{ type: "text", text: "Ready." }] });
    await using host = await open(fake, [subagents]);
    const { session: parent, receipt: ready } = await host.sessions.start({ content: "Hi." });
    await ready.settled();
    fake.reply({ content: [{ type: "text", text: "Working on it forever" }], hold: true });
    const { session: child, receipt: working } = await host.sessions.start({
      parent: parent.id,
      content: "Work.",
    });

    await until(async () =>
      (await child.view()).execution.kind === "live" && fake.requests.length === 2
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
    expect(lastResult(fake.requests[3])).toBe(
      `Stopped 1 run of subagent ${child.id} and withdrew 0 pending messages.`,
    );
    expect(settledCall((await parent.view()).messages, "call-stop").class).toEqual({
      kind: "delegate",
      child: child.id,
      role: "stop",
      title: null,
    });
  });

  it("drives a child to completion on a run kernel covering only its parent, so the parent's task resolves (§42ac)", async () => {
    const store = memoryStore();
    const fake = fakeModels();

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
      { content: [{ type: "text", text: "The answer is 42." }] },
      { content: [{ type: "text", text: "The child found 42." }] },
    );

    const seed = await open(fake, [subagents], { store, execution: { kind: "admit-only" } });
    const { session: created } = await seed.sessions.start({ content: "Delegate it." });
    await seed.close();

    const host = await open(fake, [subagents], {
      store,
      execution: { kind: "run", coverage: { kind: "sessions", sessions: [created.id] } },
    });

    const receipt = host.session(created.id).receipt(asId<"receipt">(created.id));

    expect(await receipt.settled()).toMatchObject({ kind: "completed" });
    expect(fake.requests).toHaveLength(3);

    const children = await host.sessions.list({
      parents: { kind: "children", session: created.id },
    });

    expect(children.items).toHaveLength(1);
    await host.close();
  });

  it("runs a task's subagent in a worktree, names it in the reply, and makes no second worktree when the task replays after a restart", async () => {
    const store = memoryStore();
    const fake = fakeModels();
    const created: string[] = [];

    const repo: Plugin<"core"> = {
      id: "repo",
      environment: {
        kind: "repo",
        inspect: async (target) => ({
          identity: asId(`repo:${locate(target)}`),
          availability: { kind: "available" },
          projectSources: [],
        }),
        attach: async (target) => ({
          ...env,
          identity: asId(`repo:${locate(target)}`),
        }),
        worktrees: {
          async create(_env, input) {
            created.push(input.name);

            return {
              target: { kind: "repo", locator: `worktree:${input.name}` },
              branch: `nyte/${input.title ?? input.name}`,
              base: "c0ffee",
            };
          },
          remove: async () => ({ folder: "removed", branch: "deleted" }),
          clean: async () => false,
        },
      },
    };

    const compose = () =>
      composeHost({
        store,
        models: fake.models,
        plugins: [repo, subagents],
        workspace: { kind: "repo", locator: "main" },
        home: null,
        description: { name: "test", platform: "darwin", version: "0.1.0" },
      });

    fake.reply(
      {
        content: [
          {
            type: "toolCall",
            id: "call-task",
            name: "task",
            arguments: { prompt: "Fix the login.", title: "fixer", isolation: "worktree" },
          },
        ],
      },
      { content: [{ type: "text", text: "Still fixing" }], hold: true },
    );

    const first = await compose();
    const { session: parent } = await first.sessions.start({ content: "Delegate it." });

    await until(async () => {
      const execution = (await parent.view()).execution;

      return execution.kind === "waiting" &&
        execution.on.kind === "run" &&
        fake.requests.length === 2
        ? true
        : undefined;
    });
    await first.close();

    fake.reply(
      { content: [{ type: "text", text: "Fixed it." }] },
      { content: [{ type: "text", text: "The subagent fixed it." }] },
    );

    await using second = await compose();
    const receipt = second.session(parent.id).receipt(asId<"receipt">(parent.id));

    expect(await receipt.settled()).toMatchObject({ kind: "completed" });

    const children = await second.sessions.list({
      parents: { kind: "children", session: parent.id },
    });
    const child = children.items[0];
    assert(child !== undefined);

    expect(children.items).toHaveLength(1);
    expect(created).toEqual([child.id]);

    expect(
      settledCall((await second.session(parent.id).view()).messages, "call-task").outcome,
    ).toMatchObject({
      kind: "ok",
      content: [
        {
          kind: "text",
          text: `It works in the worktree ${child.workspace} on branch nyte/fixer.\n\nSubagent ${child.id} finished.\n\nFixed it.`,
        },
      ],
    });
  });
});
