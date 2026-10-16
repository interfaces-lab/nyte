import { AssistantMessageEventStream } from "@nyte-ai/ai/utils/event-stream";
import { asId, asSeq, standard } from "@nyte-ai/schema";
import { contentText } from "@nyte-ai/schema/model";
import type { AssistantMessage } from "@nyte-ai/schema/model";
import type { DurableEvent, Infer, Message, RunId, SessionId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import {
  compaction,
  createPluginRuntime,
  decodePartRecord,
  decodeRunRecord,
  envelope,
  isPart,
  memoryStore,
  partRef,
  publishSet,
  requestBody,
  runRef,
  text,
  thinking,
  tool,
} from "../src/index.ts";
import type { Kernel, Plugin, Store, ToolDefinition } from "../src/index.ts";
import { fakeModels, open, testModel } from "./fake-models.ts";
import type { FakeModels, Reply } from "./fake-models.ts";
import { configuration, label, main, until } from "./harness.ts";

const nothing = standard(Type.Object({}));

const ZERO_TEST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const echo: ToolDefinition<{ readonly text: string }> = {
  name: "echo",
  description: "Echo the text.",
  parameters: standard(Type.Object({ text: Type.String() })),
  class: () => ({ kind: "custom", label: "Echoing" }),
  replay: "safe",
  execute: async (args) => ({ content: [{ kind: "text", text: `echo: ${args.text}` }] }),
};

const nap: ToolDefinition<Infer<typeof nothing>> = {
  name: "nap",
  description: "Sleep a little.",
  parameters: nothing,
  class: () => ({ kind: "custom", label: "Napping" }),
  replay: "safe",
  async execute(_args, invocation) {
    await invocation.wait({ kind: "timer", until: invocation.now() + 100 });

    return { content: [{ kind: "text", text: "rested" }] };
  },
};

function recorder(gate?: Promise<void>) {
  const seen: string[] = [];

  const gated: ToolDefinition<Infer<typeof nothing>> = {
    name: "wait",
    description: "Wait for the gate.",
    parameters: nothing,
    class: () => ({ kind: "custom", label: "Waiting" }),
    replay: "safe",
    async execute() {
      await gate;

      return { content: [{ kind: "text", text: "waited" }] };
    },
  };

  const plugin: Plugin<"core"> = {
    id: "recorder",
    contribute: { tools: [echo, gated] },
    hooks: {
      run_started: (view) => {
        seen.push(`run_started:${view.attempt}`);
      },
      before_request: (request) => {
        seen.push(`before_request:${request.step}:${request.attempt}`);

        return request;
      },
      after_request: (event) => {
        seen.push(`after_request:${event.step}:${event.usage.total}`);
      },
      before_compaction: (plan) => {
        seen.push(`before_compaction:${plan.reason}:${plan.summarise.length}:${plan.keep.length}`);

        return plan;
      },
      run_ended: (end) => {
        seen.push(`run_ended:${end.kind}`);
      },
    },
  };

  return { plugin, seen };
}

function events(kernel: Kernel, session: SessionId): DurableEvent[] {
  const logged: DurableEvent[] = [];

  kernel.bus.subscribe(session, (event) => {
    if (event.kind !== "patch") logged.push(event);
  });

  return logged;
}

function sent(fake: FakeModels, index: number): readonly string[] {
  return fake.requests[index].context.messages.map((message) => {
    switch (message.role) {
      case "system":
        return "system";
      case "user":
        return `user:${typeof message.content === "string" ? message.content : message.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("")}`;
      case "assistant":
        return `assistant:${message.content.map((block) => (block.type === "text" ? block.text : block.type === "thinking" ? `(${block.thinking})` : `${block.name}()`)).join("|")}`;
      case "toolResult":
        return `result:${message.content.map((block) => (block.type === "text" ? block.text : "")).join("")}`;
    }
  });
}

function lastUserText(fake: FakeModels, index: number): string {
  const message = fake.requests[index].context.messages.at(-1);

  assert(message?.role === "user");

  return contentText(message.content);
}

function settledText(messages: readonly Message[]): readonly string[] {
  return messages.flatMap((message) =>
    isPart(message, text) && message.status.kind === "settled" ? [message.state.markdown] : [],
  );
}

function runOf(messages: readonly Message[]): RunId {
  const message = messages.find((entry) => entry.kind === "user");
  assert(
    message?.kind === "user" && message.status.kind === "landed" && message.status.run !== null,
  );

  return message.status.run;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("turn", () => {
  it("streams text, thinking and tool parts and settles the run with its usage", async () => {
    const fake = fakeModels();
    const { plugin, seen } = recorder();

    fake.reply(
      {
        content: [
          { type: "thinking", thinking: "Plan the call.", signature: "sig-1" },
          { type: "thinking", thinking: "Check it.", signature: "sig-2" },
          { type: "text", text: "Calling echo.", signature: "msg-1" },
          { type: "toolCall", id: "call-1", name: "echo", arguments: { text: "hi" } },
        ],
        usage: { input: 100, output: 20 },
      },
      { content: [{ type: "text", text: "Done." }], usage: { input: 150, output: 5, cost: 0.5 } },
    );

    await using host = await open(fake, { plugins: [plugin] });
    const session = await host.sessions.create();
    const logged = events(host.kernel, session.id);
    const end = await (await session.send("Go.")).settled();

    assert(end.kind === "completed");
    expect(end.usage).toMatchObject({ input: 250, output: 25, total: 275 });
    expect(end.usage.cost.total).toBeCloseTo((100 + 20 * 2) / 1_000_000 + 0.5);

    const view = await session.view();
    const run = runOf(view.messages);
    const [user, thought, answer, call, done] = view.messages;

    expect(user).toMatchObject({ kind: "user", content: "Go." });
    assert(thought !== undefined && isPart(thought, thinking));
    expect(thought.id).toBe(`${run}:a1:0`);
    expect(thought.state).toEqual({
      markdown: "Plan the call.\n\nCheck it.",
      merged: 2,
      signature: [
        { length: 14, signature: "sig-1", redacted: false },
        { length: 9, signature: "sig-2", redacted: false },
      ],
    });
    assert(answer !== undefined && isPart(answer, text));
    expect(answer).toMatchObject({
      id: `${run}:a1:1`,
      role: "answer",
      status: { kind: "settled" },
    });
    expect(answer.state).toEqual({ markdown: "Calling echo.", signature: "msg-1" });
    assert(call !== undefined && isPart(call, tool));
    expect(call.id).toBe(`${run}:1:call-1`);
    expect(call.state).toMatchObject({
      call: `${run}:1:call-1`,
      phase: "settled",
      outcome: { kind: "ok", content: [{ kind: "text", text: "echo: hi" }] },
    });
    assert(done !== undefined && isPart(done, text));
    expect(done).toMatchObject({ id: `${run}:a1:2`, state: { markdown: "Done." } });

    expect(sent(fake, 1)).toEqual([
      "system",
      "user:Go.",
      "assistant:(Plan the call.)|(Check it.)|Calling echo.|echo()",
      "result:echo: hi",
    ]);

    const replayed = fake.requests[1].context.messages[2];
    assert(replayed?.role === "assistant");
    expect(replayed.content[0]).toMatchObject({ type: "thinking", thinkingSignature: "sig-1" });
    expect(replayed.content[2]).toMatchObject({ type: "text", textSignature: "msg-1" });

    const system = fake.requests[0].context.messages[0];
    assert(system?.role === "system");
    expect(system.toolsAdded?.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["echo", "read", "task", "read_agent"]),
    );
    expect(contentText(system.content)).toMatch(/^<0000-system-prompt>\n/);

    await until(() => (seen.includes("run_ended:completed") ? true : undefined));
    expect(seen).toEqual([
      "run_started:1",
      "before_request:assistant:1",
      "after_request:assistant:120",
      "before_request:assistant:1",
      "after_request:assistant:155",
      "run_ended:completed",
    ]);

    const requests = logged.filter((event) => event.kind === "request");

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      step: "assistant",
      context: { tokens: 155, window: 100_000 },
    });
    expect(logged.map(label)).toEqual(
      expect.arrayContaining(["run:phase", "part:settled", "call:settled", "run:ended"]),
    );
  });

  it("keeps the run's usage on its record, so a run parked and driven again totals every request", async () => {
    const fake = fakeModels();

    fake.reply(
      {
        content: [{ type: "toolCall", id: "call-nap", name: "nap", arguments: {} }],
        usage: { input: 100, output: 10 },
      },
      { content: [{ type: "text", text: "Rested." }], usage: { input: 200, output: 20 } },
    );

    await using host = await open(fake, {
      plugins: [{ id: "napper", contribute: { tools: [nap] } }],
    });

    const session = await host.sessions.create();
    const receipt = await session.send("Rest.");

    const parked = await until(async () => {
      const execution = (await session.view()).execution;

      return execution.kind === "waiting" ? execution.run.id : undefined;
    });

    const ref = await host.kernel.store.refs.get(runRef(session.id, parked));

    assert(ref?.target);
    const record = decodeRunRecord(await host.kernel.store.objects.get(ref.target));

    expect(record?.usage).toMatchObject({ input: 100, output: 10, total: 110 });
    expect(record?.requests).toBe(1);

    const end = await receipt.settled();

    assert(end.kind === "completed");
    expect(end.usage).toMatchObject({ input: 300, output: 30, total: 330 });
    expect(settledText((await session.view()).messages)).toEqual(["Rested."]);
  });

  it("runs each request's hooks on the session's current runtime: a reload between two requests of one run takes effect", async () => {
    const fake = fakeModels();
    const seen: number[] = [];
    let activations = 0;
    let reload = async (): Promise<void> => undefined;

    const reloading: ToolDefinition<Infer<typeof nothing>> = {
      name: "reload",
      description: "Reload the session's plugins.",
      parameters: nothing,
      class: () => ({ kind: "custom", label: "Reloading" }),
      replay: "safe",
      async execute() {
        await reload();

        return { content: [{ kind: "text", text: "reloaded" }] };
      },
    };

    const counted: Plugin<"core"> = {
      id: "counted",
      contribute: { tools: [reloading] },
      activate(api) {
        activations += 1;
        const activation = activations;

        api.hook("before_request", (request) => {
          seen.push(activation);

          return request;
        });
      },
    };

    fake.reply(
      { content: [{ type: "toolCall", id: "call-1", name: "reload", arguments: {} }] },
      { content: [{ type: "text", text: "Done." }] },
    );

    await using host = await open(fake, { plugins: [counted] });
    const session = await host.sessions.create();
    reload = () => host.kernel.reloadPlugins(session.id);

    expect((await (await session.send("Go.")).settled()).kind).toBe("completed");
    expect(seen).toEqual([1, 2]);
  });

  it("namespaces call ids by run and response, replays the provider's own ids, and leaves nested calls out", async () => {
    const fake = fakeModels();
    const gated: string[] = [];

    const outer: ToolDefinition<Infer<typeof nothing>> = {
      name: "outer",
      description: "Call echo inside.",
      parameters: nothing,
      class: () => ({ kind: "custom", label: "Nesting" }),
      replay: "safe",
      async execute(_args, invocation) {
        const inner = await invocation.tools.execute("echo", { text: "inner" });

        return { content: [{ kind: "text", text: `outer saw ${inner.kind}` }] };
      },
    };

    const plugin: Plugin<"core"> = {
      id: "gate",
      contribute: { tools: [echo, outer] },
      hooks: {
        before_tool: (call) => {
          gated.push(call.call);

          return { action: "continue" };
        },
      },
    };

    fake.reply(
      { content: [{ type: "toolCall", id: "call_0", name: "echo", arguments: { text: "a" } }] },
      { content: [{ type: "text", text: "First." }] },
      { content: [{ type: "toolCall", id: "call_0", name: "echo", arguments: { text: "b" } }] },
      { content: [{ type: "toolCall", id: "call_0", name: "echo", arguments: { text: "c" } }] },
      { content: [{ type: "text", text: "Second." }] },
      { content: [{ type: "toolCall", id: "call_1", name: "outer", arguments: {} }] },
      { content: [{ type: "text", text: "Third." }] },
    );

    await using host = await open(fake, { plugins: [plugin] });
    const session = await host.sessions.create();
    await (await session.send("One.")).settled();
    await (await session.send("Two.")).settled();
    await (await session.send("Three.")).settled();

    const view = await session.view();

    const runs = view.messages.flatMap((message) =>
      message.kind === "user" && message.status.kind === "landed" && message.status.run !== null
        ? [message.status.run]
        : [],
    );

    const calls = view.messages.flatMap((message) =>
      isPart(message, tool) &&
      message.state.phase === "settled" &&
      message.state.outcome.kind === "ok"
        ? [[message.id, message.state.call, message.state.outcome.content]]
        : [],
    );

    expect(runs).toHaveLength(3);
    expect(calls).toEqual([
      [`${runs[0]}:1:call_0`, `${runs[0]}:1:call_0`, [{ kind: "text", text: "echo: a" }]],
      [`${runs[1]}:1:call_0`, `${runs[1]}:1:call_0`, [{ kind: "text", text: "echo: b" }]],
      [`${runs[1]}:2:call_0`, `${runs[1]}:2:call_0`, [{ kind: "text", text: "echo: c" }]],
      [`${runs[2]}:1:call_1:0`, `${runs[2]}:1:call_1:0`, [{ kind: "text", text: "echo: inner" }]],
      [`${runs[2]}:1:call_1`, `${runs[2]}:1:call_1`, [{ kind: "text", text: "outer saw ok" }]],
    ]);
    expect(gated).toEqual([
      `${runs[0]}:1:call_0`,
      `${runs[1]}:1:call_0`,
      `${runs[1]}:2:call_0`,
      `${runs[2]}:1:call_1`,
      `${runs[2]}:1:call_1:0`,
    ]);
    expect(sent(fake, 4).slice(-4)).toEqual([
      "assistant:echo()",
      "result:echo: b",
      "assistant:echo()",
      "result:echo: c",
    ]);

    const replayed = fake.requests[6].context.messages.flatMap((message) =>
      message.role === "assistant"
        ? message.content.flatMap((block) => (block.type === "toolCall" ? [block.id] : []))
        : message.role === "toolResult"
          ? [`result:${message.toolCallId}`]
          : [],
    );

    expect(replayed).toEqual([
      "call_0",
      "result:call_0",
      "call_0",
      "result:call_0",
      "call_0",
      "result:call_0",
      "call_1",
      "result:call_1",
    ]);
    expect(sent(fake, 6).slice(-2)).toEqual(["assistant:outer()", "result:outer saw ok"]);
  });

  it("replays a response's calls in response order when the first parked and settled last", async () => {
    const fake = fakeModels();

    fake.reply(
      {
        content: [
          { type: "toolCall", id: "call-nap", name: "nap", arguments: {} },
          { type: "toolCall", id: "call-echo", name: "echo", arguments: { text: "hi" } },
        ],
      },
      { content: [{ type: "text", text: "Both." }] },
    );

    await using host = await open(fake, {
      plugins: [{ id: "tools", contribute: { tools: [nap, echo] } }],
    });

    const session = await host.sessions.create();
    const end = await (await session.send("Go.")).settled();

    expect(end.kind).toBe("completed");

    const view = await session.view();
    const run = runOf(view.messages);

    expect(
      view.messages.filter((message) => isPart(message, tool)).map((message) => message.id),
    ).toEqual([`${run}:1:call-echo`, `${run}:1:call-nap`]);
    expect(sent(fake, 1)).toEqual([
      "system",
      "user:Go.",
      "assistant:nap()|echo()",
      "result:rested",
      "result:echo: hi",
    ]);
    expect(
      fake.requests[1].context.messages.flatMap((message) =>
        message.role === "assistant"
          ? message.content.flatMap((block) => (block.type === "toolCall" ? [block.id] : []))
          : message.role === "toolResult"
            ? [`result:${message.toolCallId}`]
            : [],
      ),
    ).toEqual(["call-nap", "call-echo", "result:call-nap", "result:call-echo"]);
  });

  it("lands a steer at the boundary after the tool calls", async () => {
    const fake = fakeModels();
    let release = () => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { plugin } = recorder(gate);

    fake.reply(
      { content: [{ type: "toolCall", id: "call-wait", name: "wait", arguments: {} }] },
      { content: [{ type: "text", text: "Seen both." }] },
    );

    await using host = await open(fake, { plugins: [plugin] });
    const session = await host.sessions.create();
    const first = await session.send("Start.");

    await until(async () =>
      (await session.view()).messages.some(
        (message) => isPart(message, tool) && message.state.phase === "running",
      )
        ? true
        : undefined,
    );

    const steer = await session.send("Also this.");

    expect((await session.view()).messages.at(-1)).toMatchObject({
      kind: "user",
      status: { kind: "pending", schedule: { kind: "joined" } },
    });

    release();
    const end = await first.settled();

    expect(end.kind).toBe("completed");
    expect(await steer.settled()).toEqual(end);
    expect(sent(fake, 1)).toEqual([
      "system",
      "user:Start.",
      "assistant:wait()",
      "result:waited",
      "user:Also this.",
    ]);

    const view = await session.view();
    const run = runOf(view.messages);

    expect(view.messages.filter((message) => message.kind === "user")).toMatchObject([
      { status: { kind: "landed", run } },
      { status: { kind: "landed", run } },
    ]);
  });

  it("lands inputs sent while the final answer streams in its run: an attach rides along, a steer gets another pass", async () => {
    const fake = fakeModels();
    let release = () => {};

    const held = (answer: string) => (): Reply => ({
      content: [{ type: "text", text: answer }],
      until: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });

    const streaming = () =>
      until(async () =>
        (await session.view()).messages.some(
          (message) => isPart(message, text) && message.status.kind === "live",
        )
          ? true
          : undefined,
      );

    fake.reply(held("First answer."), held("Second answer."), {
      content: [{ type: "text", text: "Saw the steer." }],
    });

    await using host = await open(fake);
    const session = await host.sessions.create();
    const first = await session.send("Start.");

    await streaming();
    const attach = await session.send("Context.", { delivery: "attach" });
    release();
    const attached = await first.settled();

    expect(attached.kind).toBe("completed");
    expect(await attach.settled()).toEqual(attached);
    expect(fake.requests).toHaveLength(1);

    const second = await session.send("Again.");

    await streaming();
    const steer = await session.send("Also this.");
    const pending = (await session.view()).messages.at(-1);
    release();
    const steered = await second.settled();

    expect(steered.kind).toBe("completed");
    expect(await steer.settled()).toEqual(steered);
    expect(fake.requests).toHaveLength(3);
    expect(sent(fake, 1)).toEqual([
      "system",
      "user:Start.",
      "assistant:First answer.",
      "user:Context.",
      "user:Again.",
    ]);
    expect(sent(fake, 2).slice(-3)).toEqual([
      "user:Again.",
      "assistant:Second answer.",
      "user:Also this.",
    ]);

    const view = await session.view();

    const runs = view.messages.flatMap((message) =>
      message.kind === "user" && message.status.kind === "landed" ? [message.status.run] : [],
    );

    expect(runs).toHaveLength(4);
    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).not.toBe(runs[0]);
    expect(runs[3]).toBe(runs[2]);
    expect(pending).toMatchObject({
      kind: "user",
      status: { kind: "pending", schedule: { kind: "joined", run: runs[2] } },
    });
    expect(settledText(view.messages)).toEqual([
      "First answer.",
      "Second answer.",
      "Saw the steer.",
    ]);
  });

  it("compacts at the threshold and writes the part and its commit", async () => {
    const fake = fakeModels();
    const { plugin, seen } = recorder();

    const policy: Plugin<"core"> = {
      id: "policy",
      contribute: {
        modelContext: [
          { model: { provider: "test", id: "model" }, contextWindow: 2_000, compactAt: 100 },
        ],
      },
    };

    fake.reply(
      { content: [{ type: "text", text: "First answer." }] },
      {
        content: [{ type: "text", text: "They asked a first question." }],
        usage: { input: 40, output: 8 },
      },
      { content: [{ type: "text", text: "Second answer." }] },
    );

    await using host = await open(fake, { plugins: [plugin, policy] });
    const session = await host.sessions.create();
    await (await session.send("First question?")).settled();
    const logged = events(host.kernel, session.id);
    const end = await (await session.send("Second question?")).settled();

    assert(end.kind === "completed");
    expect(end.usage.input).toBe(10 + 40);
    expect(fake.requests).toHaveLength(3);
    expect(fake.requests[1].context.messages.at(-1)).toMatchObject({ role: "user" });
    expect(sent(fake, 2)).toEqual([
      "system",
      "user:The earlier conversation was summarised to fit the context window. The summary:\n\nThey asked a first question.",
      "user:Second question?",
    ]);

    const view = await session.view();
    const note = view.messages.find((message) => isPart(message, compaction));
    assert(note !== undefined && isPart(note, compaction));

    expect(note).toMatchObject({ role: "note", status: { kind: "settled" } });
    expect(note.state).toMatchObject({
      summary: "They asked a first question.",
      material: null,
      usage: { input: 40, output: 8 },
    });

    const labels = logged.map(label);
    const created = labels.indexOf("part:created");

    expect(labels.slice(created, created + 5)).toEqual([
      "part:created",
      "part:updated",
      "part:settled",
      "commit",
      "request",
    ]);
    const asked = view.messages.findLast((message) => message.kind === "user");

    assert(asked?.kind === "user" && asked.status.kind === "landed");
    expect(logged[created]).toMatchObject({
      partKind: "compaction",
      state: { summary: null },
      run: asked.status.run,
    });

    const committed = logged.find(
      (event) => event.kind === "commit" && event.body.kind === "compaction",
    );

    assert(committed?.kind === "commit" && committed.body.kind === "compaction");
    expect(committed.body.part).toBe(note.part);
    expect(committed.body.replaces).toHaveLength(2);
    expect(seen).toContain("before_compaction:threshold:2:1");
    expect(seen).toContain("after_request:compaction:48");
    expect(
      logged
        .filter((event) => event.kind === "request")
        .map((event) => event.kind === "request" && event.step),
    ).toEqual(["compaction", "assistant"]);
  });

  it("runs calls without a provider id or repeating one each under its own id", async () => {
    const fake = fakeModels();

    fake.reply(
      {
        content: [
          { type: "text", text: "Echoing." },
          { type: "toolCall", id: "", name: "echo", arguments: { text: "a" } },
          { type: "toolCall", id: "", name: "echo", arguments: { text: "b" } },
          { type: "toolCall", id: "dup", name: "echo", arguments: { text: "c" } },
          { type: "toolCall", id: "dup", name: "echo", arguments: { text: "d" } },
        ],
      },
      { content: [{ type: "text", text: "Done." }] },
    );

    await using host = await open(fake, { plugins: [recorder().plugin] });
    const session = await host.sessions.create();
    expect((await (await session.send("Go.")).settled()).kind).toBe("completed");

    const view = await session.view();
    const run = runOf(view.messages);

    expect(
      view.messages.flatMap((message) =>
        isPart(message, tool) &&
        message.state.phase === "settled" &&
        message.state.outcome.kind === "ok"
          ? [[message.id, message.state.outcome.content]]
          : [],
      ),
    ).toEqual([
      [`${run}:1:call_1`, [{ kind: "text", text: "echo: a" }]],
      [`${run}:1:call_2`, [{ kind: "text", text: "echo: b" }]],
      [`${run}:1:dup`, [{ kind: "text", text: "echo: c" }]],
      [`${run}:1:dup_4`, [{ kind: "text", text: "echo: d" }]],
    ]);
    expect(sent(fake, 1).slice(2)).toEqual([
      "assistant:Echoing.|echo()|echo()|echo()|echo()",
      "result:echo: a",
      "result:echo: b",
      "result:echo: c",
      "result:echo: d",
    ]);
    expect(
      fake.requests[1].context.messages.flatMap((message) =>
        message.role === "assistant"
          ? message.content.flatMap((block) => (block.type === "toolCall" ? [block.id] : []))
          : message.role === "toolResult"
            ? [message.toolCallId]
            : [],
      ),
    ).toEqual(["call_1", "call_2", "dup", "dup_4", "call_1", "call_2", "dup", "dup_4"]);
  });

  it("judges the threshold from the provider's reported usage, not a character count of the history", async () => {
    const fake = fakeModels();

    const policy: Plugin<"core"> = {
      id: "policy",
      contribute: {
        modelContext: [
          { model: { provider: "test", id: "model" }, contextWindow: 10_000, compactAt: 2_000 },
        ],
      },
    };

    fake.reply(
      { content: [{ type: "text", text: "First answer." }] },
      {
        content: [{ type: "toolCall", id: "a", name: "echo", arguments: { text: "a" } }],
        usage: { input: 2_500, output: 8 },
      },
      { content: [{ type: "text", text: "They asked a first question." }] },
      { content: [{ type: "text", text: "Done." }] },
    );

    await using host = await open(fake, { plugins: [recorder().plugin, policy] });
    const session = await host.sessions.create();
    await (await session.send("First question?")).settled();
    expect((await (await session.send("Second question?")).settled()).kind).toBe("completed");

    expect(fake.requests).toHaveLength(4);
    expect(lastUserText(fake, 2)).toContain("First question?");
    expect(sent(fake, 3)[1]).toContain("The earlier conversation was summarised");
    expect(
      fake.requests[3].context.messages.findLast((message) => message.role === "assistant"),
    ).toMatchObject({ usage: { input: 2_500, output: 8 } });
  });

  it("keeps a long tool result's start and end in the compaction prompt", async () => {
    const fake = fakeModels();
    const long = `BEGIN${"x".repeat(5_000)}FINISHED`;

    const policy: Plugin<"core"> = {
      id: "policy",
      contribute: {
        modelContext: [
          { model: { provider: "test", id: "model" }, contextWindow: 8_000, compactAt: 300 },
        ],
      },
    };

    fake.reply(
      { content: [{ type: "toolCall", id: "a", name: "echo", arguments: { text: long } }] },
      { content: [{ type: "text", text: "They echoed a long text." }] },
      { content: [{ type: "text", text: "Echoed." }] },
    );

    await using host = await open(fake, { plugins: [recorder().plugin, policy] });
    const session = await host.sessions.create();
    await (await session.send("Echo it.")).settled();

    const prompt = lastUserText(fake, 1);

    expect(prompt).toContain("echo returned: echo: BEGIN");
    expect(prompt).toContain("characters omitted");
    expect(prompt).toContain("xFINISHED");
  });

  it("fails every call of a response cut off at the output cap, without running any, and goes on", async () => {
    const fake = fakeModels();

    fake.reply(
      {
        content: [
          { type: "toolCall", id: "a", name: "echo", arguments: { text: "whole" } },
          { type: "toolCall", id: "b", name: "echo", arguments: { text: "cut" } },
        ],
        stopReason: "length",
        usage: { output: 4_096 },
      },
      { content: [{ type: "text", text: "Re-issued." }] },
    );

    await using host = await open(fake, { plugins: [recorder().plugin] });
    const session = await host.sessions.create();
    expect((await (await session.send("Go.")).settled()).kind).toBe("completed");

    const outcomes = (await session.view()).messages.flatMap((message) =>
      isPart(message, tool) && message.state.phase === "settled" ? [message.state.outcome] : [],
    );

    expect(outcomes).toHaveLength(2);

    for (const outcome of outcomes)
      expect(outcome).toMatchObject({
        kind: "failed",
        message: expect.stringContaining("output token limit"),
      });
    expect(sent(fake, 1).filter((line) => line.startsWith("result:echo"))).toEqual([]);
  });

  it("retries a retryable failure at the next attempt, then succeeds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const fake = fakeModels();

    fake.reply(
      { content: [{ type: "text", text: "Half" }], error: "503 Service Unavailable" },
      { content: [{ type: "text", text: "Recovered." }] },
    );

    await using host = await open(fake);
    const session = await host.sessions.create();
    const logged = events(host.kernel, session.id);
    const receipt = await session.send("Go.");

    await until(() => (logged.some((event) => label(event) === "run:retrying") ? true : undefined));
    await vi.advanceTimersByTimeAsync(2_000);
    const end = await receipt.settled();

    expect(end.kind).toBe("completed");
    const retrying = logged.find((event) => event.kind === "run" && event.change === "retrying");

    assert(retrying?.kind === "run" && retrying.change === "retrying");
    expect(retrying).toMatchObject({ attempt: 2, reason: "503 Service Unavailable" });
    expect(retrying.until).toBeGreaterThan(Date.now() - 5_000);

    const view = await session.view();
    const run = runOf(view.messages);
    const parts = view.messages.filter((message) => message.kind === "part");

    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ id: `${run}:a2:0`, state: { markdown: "Recovered." } });
    expect(
      await host.kernel.store.refs.get(partRef(session.id, asId(`${run}:a1:0`))),
    ).not.toBeNull();

    const failed = logged.find((event) => event.kind === "part" && event.change === "failed");

    expect(failed).toMatchObject({ part: `${run}:a1:0`, failure: { class: "overloaded" } });
    expect(fake.requests).toHaveLength(2);
  });

  it("settles a response's parts only once it is done, so a retried attempt's parts all fail and none of its text is replayed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const fake = fakeModels();

    fake.reply(
      {
        content: [
          { type: "text", text: "First half." },
          { type: "text", text: "Second" },
        ],
        error: "503 Service Unavailable",
      },
      { content: [{ type: "text", text: "Clean answer." }] },
    );

    await using host = await open(fake);
    const session = await host.sessions.create();
    const logged = events(host.kernel, session.id);
    const receipt = await session.send("Go.");

    await until(() => (logged.some((event) => label(event) === "run:retrying") ? true : undefined));

    const retrying = await session.view();
    const run = runOf(retrying.messages);

    expect(retrying.messages.filter((message) => message.kind === "part")).toMatchObject([
      { id: `${run}:a1:0`, status: { kind: "failed", failure: { class: "overloaded" } } },
      { id: `${run}:a1:1`, status: { kind: "failed", failure: { class: "overloaded" } } },
    ]);

    await vi.advanceTimersByTimeAsync(2_000);

    expect((await receipt.settled()).kind).toBe("completed");

    const view = await session.view();

    expect(view.messages.filter((message) => message.kind === "part")).toMatchObject([
      { id: `${run}:a2:0`, state: { markdown: "Clean answer." }, status: { kind: "settled" } },
    ]);

    for (const [id, streamed] of [
      [`${run}:a1:0`, "First half."],
      [`${run}:a1:1`, "Second"],
    ]) {
      const ref = await host.kernel.store.refs.get(partRef(session.id, asId(id)));

      assert(ref?.target);
      expect(decodePartRecord(await host.kernel.store.objects.get(ref.target))).toMatchObject({
        state: { markdown: streamed },
        status: { kind: "failed", failure: { class: "overloaded" } },
      });
    }

    expect(
      logged.flatMap((event) =>
        event.kind === "part" && event.change === "settled" ? [event.part] : [],
      ),
    ).toEqual([`${run}:a2:0`]);
    expect(sent(fake, 1)).toEqual(["system", "user:Go."]);
  });

  it("compacts once on a context overflow and retries", async () => {
    const fake = fakeModels();

    fake.reply(
      { content: [{ type: "text", text: "First answer." }] },
      { error: "prompt is too long: 213462 tokens > 200000 maximum" },
      { content: [{ type: "text", text: "Summary of the first exchange." }] },
      { content: [{ type: "text", text: "Second answer." }] },
    );

    await using host = await open(fake);
    const session = await host.sessions.create();
    await (await session.send("First?")).settled();
    const logged = events(host.kernel, session.id);
    const end = await (await session.send("Second?")).settled();

    expect(end.kind).toBe("completed");
    expect(
      logged.find((event) => event.kind === "run" && event.change === "retrying"),
    ).toMatchObject({
      attempt: 2,
    });
    expect(sent(fake, 3)).toEqual([
      "system",
      "user:The earlier conversation was summarised to fit the context window. The summary:\n\nSummary of the first exchange.",
      "user:Second?",
    ]);
    expect((await session.view()).messages.some((message) => isPart(message, compaction))).toBe(
      true,
    );
  });

  it("fails the run when an overflow leaves nothing to compact", async () => {
    const fake = fakeModels();
    fake.reply({ error: "prompt is too long: 213462 tokens > 200000 maximum" });
    await using host = await open(fake);
    const session = await host.sessions.create();
    const end = await (await session.send("Only?")).settled();

    expect(end).toMatchObject({ kind: "failed", failure: { class: "context_window" } });
  });

  it("compacts by hand: started at once, then settled in the background", async () => {
    const fake = fakeModels();
    const { plugin, seen } = recorder();

    fake.reply(
      { content: [{ type: "text", text: "One." }] },
      { content: [{ type: "text", text: "Two." }] },
      { content: [{ type: "text", text: "Earlier they counted to one." }] },
      { content: [{ type: "text", text: "Three." }] },
    );

    await using host = await open(fake, { plugins: [plugin] });
    const session = await host.sessions.create();

    expect(await session.compact()).toEqual({ kind: "nothing-to-compact" });
    await (await session.send("Count.")).settled();
    await (await session.send("Again.")).settled();
    const started = await session.compact({ instructions: "Keep the numbers." });

    assert(started.kind === "started");

    const note = await until(async () => {
      const message = (await session.view()).messages.find((entry) => entry.id === started.message);

      return message?.kind === "part" && message.status.kind === "settled" ? message : undefined;
    });

    expect(note).toMatchObject({
      partKind: "compaction",
      role: "note",
      state: { summary: "Earlier they counted to one.", material: null },
    });
    expect(lastUserText(fake, 2)).toContain("Follow these instructions: Keep the numbers.");
    expect(seen).toContain("before_compaction:manual:2:2");

    await (await session.send("Once more.")).settled();

    expect(sent(fake, 3)).toEqual([
      "system",
      "user:The earlier conversation was summarised to fit the context window. The summary:\n\nEarlier they counted to one.",
      "user:Again.",
      "assistant:Two.",
      "user:Once more.",
    ]);
  });

  it("summarises an abandoned path when moving back with summarize", async () => {
    const fake = fakeModels();

    fake.reply(
      { content: [{ type: "text", text: "First." }] },
      { content: [{ type: "text", text: "Second." }] },
      { content: [{ type: "text", text: "They asked a second time." }] },
      { content: [{ type: "text", text: "Fresh." }] },
    );

    await using host = await open(fake);
    const session = await host.sessions.create();
    await (await session.send("One?")).settled();
    await (await session.send("Two?")).settled();

    const first = (await session.view()).messages.find(
      (message) => isPart(message, text) && message.state.markdown === "First.",
    );

    assert(first?.kind === "part" && first.status.kind === "settled");

    const moved = await (
      await session.move(
        { kind: "commit", id: first.status.commit },
        { abandoned: { summarize: {} } },
      )
    ).settled();

    expect(moved).toMatchObject({ kind: "moved" });
    expect(lastUserText(fake, 2)).toContain("User: Two?\n\nAssistant: Second.");

    await (await session.send("Three?")).settled();

    expect(sent(fake, 3)).toEqual([
      "system",
      "user:One?",
      "assistant:First.",
      "user:The conversation moved back to an earlier point, abandoning a path. What that path did:\n\nThey asked a second time.",
      "user:Three?",
    ]);
  });

  it("shows a watch that starts mid-stream the text streamed before it", async () => {
    const fake = fakeModels({ models: [testModel("model")] });
    fake.reply({ content: [{ type: "text", text: "A partial answer" }], hold: true });
    await using host = await open(fake);
    const session = await host.sessions.create();
    const early = session.watch()[Symbol.asyncIterator]();
    const receipt = await session.send("Go.");
    let live: Message | undefined;

    while (live === undefined) {
      const next = await early.next();

      assert(next.done !== true);
      live = next.value.messages.find(
        (entry) => isPart(entry, text) && entry.state.markdown !== "",
      );
    }

    await early.return?.();
    const late = session.watch()[Symbol.asyncIterator]();
    const first = await late.next();
    await late.return?.();

    assert(first.done !== true);
    expect(first.value.messages.find((message) => message.id === live?.id)).toMatchObject({
      status: { kind: "live" },
      state: { markdown: "A partia" },
    });

    assert(live.kind === "part" && live.status.kind === "live" && live.status.run !== null);
    await session.run(live.status.run).stop();
    expect(await receipt.settled()).toEqual({ kind: "stopped" });
  });

  it("ends stopped when stopped mid-stream, its live part failed", async () => {
    const fake = fakeModels({ models: [testModel("model")] });
    fake.reply({ content: [{ type: "text", text: "A partial answer" }], hold: true });
    await using host = await open(fake);
    const session = await host.sessions.create();
    const watching = session.watch()[Symbol.asyncIterator]();
    const receipt = await session.send("Go.");
    let live: Message | undefined;

    while (live === undefined) {
      const next = await watching.next();

      assert(next.done !== true);
      live = next.value.messages.find(
        (entry) => isPart(entry, text) && entry.state.markdown !== "",
      );
    }

    await watching.return?.();

    assert(live.kind === "part" && live.status.kind === "live" && live.status.run !== null);
    expect(live.state).toMatchObject({ markdown: "A partia" });
    expect(await session.run(live.status.run).stop()).toEqual({ kind: "requested" });
    expect(await receipt.settled()).toEqual({ kind: "stopped" });

    const view = await session.view();

    expect(view.execution).toMatchObject({ kind: "idle", lastRun: { end: { kind: "stopped" } } });
    expect(view.messages.find((message) => message.id === live?.id)).toMatchObject({
      status: { kind: "failed", failure: { class: "aborted" } },
    });
    expect(fake.requests[0].options?.signal?.aborted).toBe(true);
  });

  it("keeps a tool call stopped mid-run in history once the next message lands", async () => {
    const fake = fakeModels();
    const started = Promise.withResolvers<void>();

    const hang: ToolDefinition<Infer<typeof nothing>> = {
      name: "hang",
      description: "Run until stopped.",
      parameters: nothing,
      class: () => ({ kind: "custom", label: "Hanging" }),
      replay: "safe",
      async execute(_args, invocation) {
        started.resolve();
        await new Promise((resolve) =>
          invocation.signal.addEventListener("abort", resolve, { once: true }),
        );

        return { content: [{ kind: "text", text: "done" }] };
      },
    };

    fake.reply(
      { content: [{ type: "toolCall", id: "call-hang", name: "hang", arguments: {} }] },
      { content: [{ type: "text", text: "Okay." }] },
    );

    await using host = await open(fake, {
      plugins: [{ id: "hang", contribute: { tools: [hang] } }],
    });

    const session = await host.sessions.create();
    const receipt = await session.send("Go.");
    await started.promise;

    expect(await session.run(runOf((await session.view()).messages)).stop()).toEqual({
      kind: "requested",
    });
    expect(await receipt.settled()).toEqual({ kind: "stopped" });
    expect(await (await session.send("Next.")).settled()).toMatchObject({ kind: "completed" });

    const call = (await session.view()).messages.find((message) => isPart(message, tool));

    expect(call).toMatchObject({
      status: { kind: "settled" },
      state: { name: "hang", phase: "settled", outcome: { kind: "stopped" } },
    });
    expect(sent(fake, 1)).toEqual([
      "system",
      "user:Go.",
      "assistant:hang()",
      "result:The tool call was stopped before it finished.",
      "user:Next.",
    ]);
  });
});

describe("turn findings (CORE-DIET D3)", () => {
  async function storedStatus(kernel: Kernel, session: SessionId, part: string) {
    const ref = await kernel.store.refs.get(partRef(session, asId(part)));

    return decodePartRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null)
      ?.status;
  }

  it("builds each request on the session's runtime once it is ready, so a reload still activating holds the request (D1)", async () => {
    const fake = fakeModels();
    const seen: string[] = [];
    const gate = Promise.withResolvers<void>();
    let activations = 0;
    let reload = (): void => undefined;

    const reloading: ToolDefinition<Infer<typeof nothing>> = {
      name: "reload",
      description: "Reload the session's plugins without waiting.",
      parameters: nothing,
      class: () => ({ kind: "custom", label: "Reloading" }),
      replay: "safe",
      async execute() {
        reload();

        return { content: [{ kind: "text", text: "reloading" }] };
      },
    };

    const slow: Plugin<"core"> = {
      id: "slow",
      contribute: { tools: [reloading] },
      async activate(api) {
        activations += 1;
        const activation = activations;

        if (activation === 2) await gate.promise;

        api.hook("before_request", (request) => {
          seen.push(`before_request:${activation}`);

          return request;
        });
      },
    };

    fake.reply(
      { content: [{ type: "toolCall", id: "call-1", name: "reload", arguments: {} }] },
      { content: [{ type: "text", text: "Done." }] },
    );

    await using host = await open(fake, { plugins: [slow] });
    const session = await host.sessions.create();

    reload = () => {
      void host.kernel.reloadPlugins(session.id);
      setTimeout(() => gate.resolve(), 20);
    };

    expect((await (await session.send("Go.")).settled()).kind).toBe("completed");
    expect(seen).toEqual(["before_request:1", "before_request:2"]);

    const system = fake.requests[1].context.messages[0];

    assert(system?.role === "system");
    expect(system.toolsAdded?.map((entry) => entry.name)).toContain("reload");
  });

  it("lists a request's tools from the runtime it was given, never the session's current one (D1, audit)", async () => {
    const fake = fakeModels();

    const marker: ToolDefinition<Infer<typeof nothing>> = {
      name: "marker",
      description: "A tool only the given runtime lists.",
      parameters: nothing,
      class: () => ({ kind: "custom", label: "Marking" }),
      replay: "safe",
      execute: async () => ({ content: [{ kind: "text", text: "marked" }] }),
    };

    await using host = await open(fake);
    const session = await host.sessions.create();
    await host.kernel.pluginsFor(session.id).ready;
    const given = createPluginRuntime(host.kernel, session.id, null);
    await given.ready;
    await given.load([{ id: "marker", contribute: { tools: [marker] } }]);

    const { transcript } = await requestBody(host.kernel, fake.models, given, {
      session: session.id,
      head: main,
      run: null,
      configuration,
    });

    expect(transcript.tools.map((info) => info.name)).toContain("marker");
    expect(
      host.kernel
        .tools(host.kernel.pluginsFor(session.id))
        .list()
        .map((info) => info.name),
    ).not.toContain("marker");
  });

  it("fails the request, not the loop, when compaction throws: the overflowed response's parts fail (D4)", async () => {
    const fake = fakeModels();

    const failing: Plugin<"core"> = {
      id: "failing",
      hooks: {
        before_compaction: () => {
          throw new Error("The compactor is down.");
        },
      },
    };

    fake.reply(
      { content: [{ type: "text", text: "First answer." }] },
      {
        content: [{ type: "text", text: "Streamed before the overflow." }],
        error: "prompt is too long: 213462 tokens > 200000 maximum",
      },
    );

    await using host = await open(fake, { plugins: [failing] });
    const session = await host.sessions.create();
    await (await session.send("First?")).settled();
    const end = await (await session.send("Second?")).settled();

    expect(end).toMatchObject({ kind: "failed", failure: { class: "runner" } });

    const second = (await session.view()).messages.find(
      (message) => message.kind === "user" && message.content === "Second?",
    );

    assert(
      second?.kind === "user" && second.status.kind === "landed" && second.status.run !== null,
    );
    expect(await storedStatus(host.kernel, session.id, `${second.status.run}:a1:0`)).toMatchObject({
      kind: "failed",
    });
  });

  it("leaves a stop that lands while a retry is landing to its fence: no overwrite, no retrying after stopping, the response still charged once (D5; audit D2 item 2)", async () => {
    const fake = fakeModels();
    const observed: number[] = [];
    let stop: ((run: RunId) => Promise<unknown>) | null = null;
    const base = memoryStore();

    const store: Store = {
      ...base,
      async open() {
        const opened = await base.open();

        return {
          ...opened,
          refs: {
            ...opened.refs,
            async set(updates) {
              const retrying = updates.find(
                (update) => update.event?.kind === "run" && update.event.change === "retrying",
              )?.event;

              if (retrying?.kind === "run" && stop !== null) {
                const stopping = stop;
                stop = null;
                await stopping(retrying.run);
              }

              return opened.refs.set(updates);
            },
          },
        };
      },
    };

    fake.reply({
      content: [{ type: "text", text: "Half an answer" }],
      error: "503 Service Unavailable",
      usage: { input: 100, output: 10 },
    });

    const observer: Plugin<"core"> = {
      id: "observer",
      hooks: {
        after_request: (event) => {
          observed.push(event.usage.total);
        },
      },
    };

    await using host = await open(fake, { store, plugins: [observer] });
    const session = await host.sessions.create();
    const logged = events(host.kernel, session.id);
    stop = (run) => session.run(run).stop();

    expect(await (await session.send("Go.")).settled()).toEqual({ kind: "stopped" });

    const run = runOf((await session.view()).messages);

    expect(await storedStatus(host.kernel, session.id, `${run}:a1:0`)).toMatchObject({
      kind: "failed",
      failure: { class: "aborted" },
    });
    expect(
      logged.filter((event) => event.kind === "part" && event.change === "failed"),
    ).toHaveLength(1);
    expect(logged.map(label)).not.toContain("run:retrying");
    expect(observed).toEqual([110]);
    expect(
      (await host.kernel.store.refs.log(session.id, asSeq(0), 1000)).flatMap((event) =>
        event.kind === "request" ? [event.usage.total] : [],
      ),
    ).toEqual([110]);
  });

  it("charges every provider request: a failed one with its request event, a material compaction with one (D6)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const fake = fakeModels();

    const material: Plugin<"core"> = {
      id: "material",
      contribute: {
        modelContext: [
          { model: { provider: "test", id: "model" }, contextWindow: 2_000, compactAt: 100 },
        ],
      },
      hooks: {
        before_compaction: (plan) => ({
          ...plan,
          result: {
            kind: "material",
            provider: "test",
            api: "test-api",
            model: "model",
            data: { opaque: true },
            usage: { ...ZERO_TEST, input: 7, total: 7 },
          },
        }),
      },
    };

    fake.reply(
      { content: [{ type: "text", text: "First answer." }] },
      {
        content: [{ type: "text", text: "Half" }],
        error: "503 Service Unavailable",
        usage: { input: 100, output: 10 },
      },
      { content: [{ type: "text", text: "Recovered." }], usage: { input: 200, output: 20 } },
    );

    await using host = await open(fake, { plugins: [material] });
    const session = await host.sessions.create();
    await (await session.send("First?")).settled();
    const logged = events(host.kernel, session.id);
    const receipt = await session.send("Second?");

    await until(() => (logged.some((event) => label(event) === "run:retrying") ? true : undefined));
    await vi.advanceTimersByTimeAsync(2_000);
    const end = await receipt.settled();

    assert(end.kind === "completed");
    expect(end.usage).toMatchObject({ input: 7 + 100 + 200, output: 10 + 20 });
    expect(
      logged.flatMap((event) =>
        event.kind === "request" ? [`${event.step}:${event.usage.total}`] : [],
      ),
    ).toEqual(["compaction:7", "assistant:110", "assistant:220"]);
  });

  it("charges and observes every request: overflow, summary, 503, 503, then a stop in the sleep (D6, audit)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const fake = fakeModels();
    const observed: string[] = [];

    const observer: Plugin<"core"> = {
      id: "observer",
      hooks: {
        after_request: (event) => {
          observed.push(`${event.step}:${event.usage.total}`);
        },
      },
    };

    fake.reply(
      { content: [{ type: "text", text: "First answer." }] },
      {
        error: "prompt is too long: 213462 tokens > 200000 maximum",
        usage: { input: 40, output: 4 },
      },
      { content: [{ type: "text", text: "Summary." }], usage: { input: 180, output: 20 } },
      {
        content: [{ type: "text", text: "Half" }],
        error: "503 Service Unavailable",
        usage: { input: 100, output: 10 },
      },
      {
        content: [{ type: "text", text: "Half again" }],
        error: "503 Service Unavailable",
        usage: { input: 150, output: 15 },
      },
    );

    await using host = await open(fake, { plugins: [observer] });
    const session = await host.sessions.create();
    await (await session.send("First?")).settled();
    observed.length = 0;
    const logged = events(host.kernel, session.id);
    const receipt = await session.send("Second?");
    const retries = (count: number) =>
      logged.filter((event) => label(event) === "run:retrying").length >= count ? true : undefined;

    await until(() => retries(2));
    await vi.advanceTimersByTimeAsync(2_000);
    await until(() => retries(3));

    const second = (await session.view()).messages.find(
      (message) => message.kind === "user" && message.content === "Second?",
    );

    assert(
      second?.kind === "user" && second.status.kind === "landed" && second.status.run !== null,
    );
    await session.run(second.status.run).stop();

    const charged = ["compaction:200", "assistant:44", "assistant:110", "assistant:165"];

    expect(await receipt.settled()).toEqual({ kind: "stopped" });
    expect(
      logged.flatMap((event) =>
        event.kind === "request" ? [`${event.step}:${event.usage.total}`] : [],
      ),
    ).toEqual(charged);
    expect(observed).toEqual(charged);
  });

  it("charges and observes a terminal failure, and an overflow whose recovery preparation throws, on the request's runtime (D3b, audit 2 item 1)", async () => {
    const fake = fakeModels();
    const observed: string[] = [];

    const plugin: Plugin<"core"> = {
      id: "observer",
      hooks: {
        after_request: (event) => {
          observed.push(`${event.step}:${event.usage.total}`);
        },
        before_compaction: () => {
          throw new Error("The compactor is down.");
        },
      },
    };

    fake.reply(
      {
        content: [{ type: "text", text: "Half" }],
        error: "401 Invalid API key",
        usage: { input: 90, output: 9 },
      },
      {
        error: "prompt is too long: 213462 tokens > 200000 maximum",
        usage: { input: 40, output: 4 },
      },
    );

    await using host = await open(fake, { plugins: [plugin] });
    const session = await host.sessions.create();
    const logged = events(host.kernel, session.id);
    const unauthorized = await (await session.send("First?")).settled();
    const overflowed = await (await session.send("Second?")).settled();

    expect(unauthorized).toMatchObject({ kind: "failed" });
    expect(overflowed).toMatchObject({ kind: "failed", failure: { class: "runner" } });
    expect(
      logged.flatMap((event) =>
        event.kind === "request" ? [`${event.step}:${event.usage.total}`] : [],
      ),
    ).toEqual(["assistant:99", "assistant:44"]);
    expect(observed).toEqual(["assistant:99", "assistant:44"]);

    const runs = (await session.view()).messages.flatMap((message) =>
      message.kind === "user" && message.status.kind === "landed" && message.status.run !== null
        ? [message.status.run]
        : [],
    );

    expect(await storedStatus(host.kernel, session.id, `${runs[0]}:a1:0`)).toMatchObject({
      kind: "failed",
    });
  });

  it("validates a before_compaction result once, failing the threshold compaction and sending the request uncompacted, never dropping history at read (D9)", async () => {
    const fake = fakeModels();

    const broken: Plugin<"core"> = {
      id: "broken",
      contribute: {
        modelContext: [
          { model: { provider: "test", id: "model" }, contextWindow: 2_000, compactAt: 100 },
        ],
      },
      hooks: {
        before_compaction: (plan) => ({
          ...plan,
          result: {
            kind: "material",
            provider: "test",
            api: "test-api",
            model: "model",
            data: null,
            usage: { ...ZERO_TEST, total: Number.NaN },
          },
        }),
      },
    };

    fake.reply(
      { content: [{ type: "text", text: "First answer." }] },
      { content: [{ type: "text", text: "Second answer." }] },
    );
    await using host = await open(fake, { plugins: [broken] });
    const session = await host.sessions.create();
    await (await session.send("First?")).settled();
    const end = await (await session.send("Second?")).settled();

    expect(end.kind).toBe("completed");
    expect((await session.view()).messages.some((message) => isPart(message, compaction))).toBe(
      false,
    );
    expect(sent(fake, 1)).toEqual([
      "system",
      "user:First?",
      "assistant:First answer.",
      "user:Second?",
    ]);
  });

  it("fails a stream that ends without a result as a provider failure, its streamed text failed in the store (D7, audit)", async () => {
    const fake = fakeModels();

    const partial: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Half" }],
      api: "test-api",
      provider: "test",
      model: "model",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 0,
    };

    fake.models.streamSimple = () => {
      const stream = new AssistantMessageEventStream();
      stream.push({ type: "start", partial });
      stream.push({ type: "text_start", contentIndex: 0, partial });
      stream.push({ type: "text_delta", contentIndex: 0, delta: "Half", partial });
      stream.end();

      return stream;
    };

    await using host = await open(fake);
    const session = await host.sessions.create();
    const end = await (await session.send("Go.")).settled();

    expect(end).toMatchObject({ kind: "failed", failure: { class: "provider" } });
    expect(
      await storedStatus(host.kernel, session.id, `${runOf((await session.view()).messages)}:a1:0`),
    ).toMatchObject({
      kind: "failed",
      failure: { class: "provider" },
    });
  });

  it("fails a request whose head holds a corrupt compaction, before sending anything (D9, audit)", async () => {
    const fake = fakeModels();

    const material: Plugin<"core"> = {
      id: "material",
      hooks: {
        before_compaction: (plan) => ({
          ...plan,
          result: {
            kind: "material",
            provider: "test",
            api: "test-api",
            model: "model",
            data: { opaque: true },
            usage: null,
          },
        }),
      },
    };

    fake.reply(
      { content: [{ type: "text", text: "First answer." }] },
      { error: "prompt is too long: 213462 tokens > 200000 maximum" },
      { content: [{ type: "text", text: "Second answer." }] },
    );

    await using host = await open(fake, { plugins: [material] });
    const session = await host.sessions.create();
    await (await session.send("First?")).settled();
    expect((await (await session.send("Second?")).settled()).kind).toBe("completed");
    expect(fake.requests[2].context.checkpoint).toMatchObject({ provider: "test" });

    const note = (await session.view()).messages.find((message) => isPart(message, compaction));
    assert(note !== undefined);
    const name = partRef(session.id, asId(note.id));
    const ref = await host.kernel.store.refs.get(name);
    const record = decodePartRecord(
      ref?.target ? await host.kernel.store.objects.get(ref.target) : null,
    );
    assert(ref !== null && record !== null);
    const corrupt = { summary: null, material: null, tokensBefore: "many", usage: null };
    const version = record.version + 1;

    const updates = [
      {
        name,
        target: await host.kernel.store.objects.put(
          envelope("part", { ...record, state: corrupt, version }, Date.now()),
        ),
        expect: ref.revision,
        event: {
          head: main,
          kind: "part",
          part: asId<"part">(note.id),
          change: "updated",
          state: corrupt,
          version,
        } as const,
      },
    ];

    await publishSet(host.kernel, updates, await host.kernel.store.refs.set(updates));

    expect(await (await session.send("Third?")).settled()).toMatchObject({
      kind: "failed",
      failure: { message: expect.stringContaining("corrupt") },
    });
    expect(fake.requests).toHaveLength(3);
  });

  it("fails the request when the session's resources cannot be read, never sending without them (D13)", async () => {
    const fake = fakeModels();
    fake.reply({ content: [{ type: "text", text: "Never sent." }] });
    await using host = await open(fake);
    const session = await host.sessions.create();

    host.kernel.resources = async () => {
      throw new Error("The workspace is unreachable.");
    };

    expect(await (await session.send("Go.")).settled()).toMatchObject({
      kind: "failed",
      failure: { message: "The workspace is unreachable." },
    });
    expect(fake.requests).toHaveLength(0);
  });

  it("D-2 N3: a part left live when the turn throws after opening it is failed by the run's end write", async () => {
    const fake = fakeModels();
    const base = memoryStore();
    let locked = true;

    const store: Store = {
      ...base,
      async open() {
        const opened = await base.open();

        return {
          ...opened,
          refs: {
            ...opened.refs,
            async set(updates) {
              if (
                locked &&
                updates.some(
                  (update) => update.event?.kind === "part" && update.event.change === "settled",
                )
              ) {
                locked = false;

                throw new Error("database is locked");
              }

              return opened.refs.set(updates);
            },
          },
        };
      },
    };

    fake.reply({ content: [{ type: "text", text: "An answer." }] });
    await using host = await open(fake, { store });
    const session = await host.sessions.create();
    const end = await (await session.send("Go.")).settled();
    const run = runOf((await session.view()).messages);

    expect(end).toMatchObject({ kind: "failed", failure: { class: "runner" } });
    expect(await storedStatus(host.kernel, session.id, `${run}:a1:0`)).toMatchObject({
      kind: "failed",
      failure: { class: "runner" },
    });
  });
});
