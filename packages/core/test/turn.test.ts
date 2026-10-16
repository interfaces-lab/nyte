import { asId } from "@nyte-ai/schema";
import { contentText } from "@nyte-ai/schema/model";
import type { Infer, Message } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { isPart, text, thinking, tool } from "../src/index.ts";
import { decodePartRecord, decodeRunRecord, memoryStore, partRef, runRef } from "../src/store.ts";
import type { Plugin, Store, ToolDefinition } from "../src/index.ts";
import { fakeModels, open, testModel } from "./fake-models.ts";
import type { Reply } from "./fake-models.ts";
import { expireLease, label, main, until } from "../src/harness.ts";
import {
  nothing,
  echo,
  nap,
  recorder,
  events,
  sent,
  settledText,
  landedRun,
} from "./turn-support.ts";

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
    const run = landedRun(view.messages);
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
    expect(answer.state).toEqual({
      markdown: "Calling echo.",
      signature: "msg-1",
      usage: expect.objectContaining({ input: 100, output: 20, total: 120 }),
    });
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
    reload = () => host.kernel.plugins.reload(session.id);

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
    const run = landedRun(view.messages);

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
    const run = landedRun(view.messages);

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
    const run = landedRun(view.messages);

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

  it("owes every call of a response once it settles: a host that stops before the first call runs leaves the next host the whole batch, the response charged once", async () => {
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
          { type: "toolCall", id: "a", name: "echo", arguments: { text: "one" } },
          { type: "toolCall", id: "b", name: "echo", arguments: { text: "two" } },
        ],
      },
      { content: [{ type: "text", text: "Done." }] },
    );

    const stopped = await open(fake, { store: crashing, plugins: [recorder().plugin] });
    const session = await stopped.sessions.create();
    await session.send("Go.");
    await until(() => (crashed ? true : undefined));
    await stopped.close();
    await expireLease(backing, session.id, main);

    await using host = await open(fake, { store: shared, plugins: [recorder().plugin] });

    const ended = await until(async () => {
      const { execution } = await host.session(session.id).view();

      return execution.kind === "idle" && execution.lastRun !== null
        ? execution.lastRun
        : undefined;
    });

    expect(ended.end).toMatchObject({
      kind: "completed",
      usage: { input: 20, output: 10 },
    });

    const echoed = (await host.session(session.id).view()).messages.flatMap((message) =>
      isPart(message, tool) && message.state.phase === "settled" ? [message.state.outcome] : [],
    );

    expect(echoed).toEqual([
      expect.objectContaining({ kind: "ok", content: [{ kind: "text", text: "echo: one" }] }),
      expect.objectContaining({ kind: "ok", content: [{ kind: "text", text: "echo: two" }] }),
    ]);
    expect(fake.requests).toHaveLength(2);
  });

  it("drops the calls a stopped run recorded but never opened, leaving no work owed", async () => {
    const fake = fakeModels();
    const gate = Promise.withResolvers<void>();
    const { plugin } = recorder(gate.promise);

    fake.reply({
      content: [
        { type: "toolCall", id: "a", name: "wait", arguments: {} },
        { type: "toolCall", id: "b", name: "echo", arguments: { text: "never" } },
      ],
    });

    await using host = await open(fake, { plugins: [plugin] });
    const session = await host.sessions.create();
    const receipt = await session.send("Go.");

    const run = await until(async () => {
      const { execution } = await session.view();

      return execution.kind === "live" && execution.phase === "executing"
        ? execution.run.id
        : undefined;
    });

    expect(await session.run(run).stop()).toEqual({ kind: "requested" });
    gate.resolve();

    expect(await receipt.settled()).toEqual({ kind: "stopped" });
    expect(
      await host.kernel.store.sessions.pending({ kind: "call", sessions: [session.id] }),
    ).toEqual([]);
    expect(
      (await session.view()).messages.some(
        (message) => isPart(message, tool) && message.state.name === "echo",
      ),
    ).toBe(false);
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
    const run = landedRun(view.messages);
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
    const run = landedRun(retrying.messages);

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

    expect(await session.run(landedRun((await session.view()).messages)).stop()).toEqual({
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
