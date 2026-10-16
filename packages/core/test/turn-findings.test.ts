import { AssistantMessageEventStream } from "@nyte-ai/ai/utils/event-stream";
import { asId, asSeq } from "@nyte-ai/schema";
import type { AssistantMessage } from "@nyte-ai/schema/model";
import type { Infer, RunId, SessionId } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { requestBody } from "../src/agent/transcript.ts";
import { createPluginRuntime } from "../src/extend/plugin-runtime.ts";
import { toolSource } from "../src/extend/registry.ts";
import { publishSet } from "../src/fold/watch.ts";
import { compaction, isPart } from "../src/index.ts";
import { decodePartRecord, envelope, memoryStore, partRef } from "../src/store.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type { Plugin, Store, ToolDefinition } from "../src/index.ts";
import { fakeModels, open } from "./fake-models.ts";
import { configuration, label, main, until } from "../src/harness.ts";
import { nothing, ZERO_TEST, events, sent, landedRun } from "./turn-support.ts";

afterEach(() => {
  vi.useRealTimers();
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
      void host.kernel.plugins.reload(session.id);
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
    await host.kernel.plugins.runtime(session.id).ready;
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
      toolSource(host.kernel.plugins.runtime(session.id))
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
              const retrying = updates
                .flatMap((update) => update.events ?? [])
                .find((event) => event.kind === "run" && event.change === "retrying");

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

    const run = landedRun((await session.view()).messages);

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
      { content: [{ type: "text", text: "First answer." }], usage: { input: 150, output: 5 } },
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
      await storedStatus(
        host.kernel,
        session.id,
        `${landedRun((await session.view()).messages)}:a1:0`,
      ),
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
        events: [
          {
            head: main,
            kind: "part",
            part: asId<"part">(note.id),
            change: "updated",
            state: corrupt,
            version,
          } as const,
        ],
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
    const unreadable = Promise.reject(new Error("The workspace is unreachable."));
    unreadable.catch(() => undefined);

    host.kernel.workspaceState.scans.set(session.id, {
      workspace: (await session.info()).workspace,
      resources: unreadable,
      stop: () => undefined,
    });

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
                updates
                  .flatMap((update) => update.events ?? [])
                  .some((event) => event.kind === "part" && event.change === "settled")
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
    const run = landedRun((await session.view()).messages);

    expect(end).toMatchObject({ kind: "failed", failure: { class: "runner" } });
    expect(await storedStatus(host.kernel, session.id, `${run}:a1:0`)).toMatchObject({
      kind: "failed",
      failure: { class: "runner" },
    });
  });
});
