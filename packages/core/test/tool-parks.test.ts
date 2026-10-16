import { asId, asSeq, standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { pollStore } from "../src/fold/watch.ts";
import { definePart } from "../src/index.ts";
import { decodePartRecord, envelope, memoryStore, partRef } from "../src/store.ts";
import type { StoreConnection, ToolDefinition } from "../src/index.ts";
import { expireLease, main, setup, until } from "../src/harness.ts";
import { echo, toolPlugin, liveRun, call, readCall, readRun, toolPart } from "./tool-support.ts";

describe("parked tool calls", () => {
  it("parks a call through advance, reports its deadline, and resumes the run once it wakes", async () => {
    const parker = {
      name: "parker",
      description: "Wait for a timer.",
      parameters: standard(Type.Object({ until: Type.Number() })),
      class: () => ({ kind: "custom", label: "Waiting" }),
      replay: "safe",
      execute: async (args, invocation) => ({
        content: [
          {
            kind: "text",
            text: (await invocation.wait({ kind: "timer", until: args.until })).kind,
          },
        ],
      }),
    } satisfies ToolDefinition<{ until: number }>;

    const { kernel, host, script } = await setup({ plugins: [toolPlugin([parker])] });
    const { session } = await host.sessions.start({ content: "Hi." });
    const head = { session: session.id, head: main };
    const at = Date.now() + 60_000;
    const receipt = await session.send("Wait for it.");
    const step = host.execution.advance(head);
    const turn = await script.started(1);
    const run = turn.input.run.id;

    expect(
      await call(kernel, {
        session: session.id,
        run,
        call: "w1",
        name: "parker",
        args: { until: at },
      }),
    ).toEqual({ kind: "parked" });
    turn.finish({ kind: "parked" });
    await step;

    expect((await session.view()).execution).toMatchObject({ kind: "waiting", run: { id: run } });
    expect(await host.execution.advance(head)).toEqual({ kind: "waiting", until: at });
    expect(await host.execution.repair({ limit: 10 })).toEqual({ runnable: [], next: null });
    await kernel.waits.tick(at);
    expect(await host.execution.repair({ limit: 10 })).toEqual({ runnable: [head], next: null });

    const resumed = host.execution.advance(head);
    const next = await script.started(2);

    expect(next.input.run.id).toBe(run);
    expect((await toolPart(session, "w1")).state).toMatchObject({
      phase: "settled",
      outcome: { kind: "ok", content: [{ kind: "text", text: "timer" }] },
    });
    next.finish();

    expect(await resumed).toEqual({ kind: "idle" });
    expect(await receipt.settled()).toMatchObject({ kind: "completed" });
  });

  it("wakes a parked call with stopped when its run stops, and ends the run stopped", async () => {
    const seen: string[] = [];

    const parker = {
      name: "parker",
      description: "Wait for a timer.",
      parameters: standard(Type.Object({})),
      class: () => ({ kind: "custom", label: "Waiting" }),
      replay: "safe",
      execute: async (_args, invocation) => {
        const woke = await invocation.wait({ kind: "timer", until: Date.now() + 60_000 });
        seen.push(woke.kind);

        return { content: [{ kind: "text", text: woke.kind }] };
      },
    } satisfies ToolDefinition<object>;

    const { kernel, host, script } = await setup({ plugins: [toolPlugin([parker])] });
    const { session } = await host.sessions.start({ content: "Hi." });
    const head = { session: session.id, head: main };
    await session.send("Wait.");
    const step = host.execution.advance(head);
    const turn = await script.started(1);
    const run = turn.input.run.id;

    expect(
      await call(kernel, { session: session.id, run, call: "w1", name: "parker", args: {} }),
    ).toEqual({ kind: "parked" });
    turn.finish({ kind: "parked" });
    await step;

    expect(await session.run(run).stop()).toEqual({ kind: "requested" });
    expect(await host.execution.advance(head)).toEqual({ kind: "idle" });
    expect(seen).toEqual(["stopped"]);
    expect(await session.run(run).settled()).toEqual({ kind: "stopped" });
    expect((await readCall(kernel, session.id, "w1")).result).toEqual({ kind: "stopped" });

    const part = await toolPart(session, "w1");

    expect(part.status).toMatchObject({ kind: "settled" });
    expect(part.state).toMatchObject({ phase: "settled", outcome: { kind: "stopped" } });
    expect(
      (await kernel.store.refs.log(session.id, asSeq(0), 100)).filter(
        (event) => event.kind === "commit" && event.body.kind === "part",
      ),
    ).toMatchObject([{ run, body: { part: "w1" } }]);
  });

  it("resumes a call parked on a modal question on one kernel once another kernel answers it, by the call the part names, the park shown in the view and the answer reaching a kernel with nothing parked (§42x, §42z, §42ac)", async () => {
    const question = definePart({
      kind: "test/question",
      state: standard(Type.Object({})),
      actions: { answer: { input: standard(Type.Object({ choice: Type.String() })) } },
      fallback: (_state, { id }) => `Ask ${id}`,
    });

    const ask = {
      name: "ask",
      description: "Wait for the answer to a question.",
      parameters: standard(Type.Object({ part: Type.String() })),
      class: () => ({ kind: "custom", label: "Asking" }),
      replay: "safe",
      execute: async (args, invocation) => {
        const woke = await invocation.wait({ kind: "part", part: asId(args.part) });

        return {
          content: [
            {
              kind: "text",
              text:
                woke.kind === "part" && woke.answer !== null
                  ? JSON.stringify(woke.answer.input)
                  : "unanswered",
            },
          ],
        };
      },
    } satisfies ToolDefinition<{ part: string }>;

    const store = await memoryStore().open();
    const lists: string[] = [];

    const spied: StoreConnection = {
      ...store,
      refs: {
        ...store.refs,
        list(prefix) {
          lists.push(prefix);

          return store.refs.list(prefix);
        },
      },
    };

    const first = await setup({ store, plugins: [toolPlugin([ask])], poll: 10 });
    const second = await setup({ store: spied });
    const third = await setup({ store, poll: 10 });
    const { session } = await first.host.sessions.start({ content: "Hi." });
    const run = await liveRun(first.kernel, session.id);
    const part = await session.parts.create(question, { state: {}, placement: { kind: "modal" } });
    const notified: string[] = [];
    first.kernel.wakes.subscribe((woken, head) => notified.push(`${woken}/${head}`));
    const input = { session: session.id, run, call: "ask", name: "ask", args: { part: part.id } };
    const unpoll = pollStore(first.kernel);

    expect(await call(first.kernel, input)).toEqual({ kind: "parked" });

    const stored = await store.refs.get(partRef(session.id, part.id));

    expect(
      decodePartRecord(stored?.target ? await store.objects.get(stored.target) : null)?.status,
    ).toEqual({ kind: "live", run: null, waiting: "ask" });
    expect((await session.view()).parts.find((view) => view.id === part.id)?.status).toEqual({
      kind: "live",
      run: null,
      waiting: "ask",
    });

    const asked = part.answer();
    const elsewhere = third.host.session(session.id).part(part.id).answer();
    const unpollThird = pollStore(third.kernel);
    lists.length = 0;

    expect(
      await second.host.session(session.id).part(part.id).act("answer", { choice: "yes" }),
    ).toEqual({ kind: "ok", output: undefined });
    expect(lists.filter((prefix) => prefix.includes("/calls/"))).toEqual([]);
    expect(await readCall(second.kernel, session.id, "ask")).toMatchObject({
      waiting: null,
      waits: [
        { kind: "part", part: part.id, answer: { action: "answer", input: { choice: "yes" } } },
      ],
    });

    await until(() => (notified.length > 0 ? true : undefined));

    expect(notified).toEqual([`${session.id}/${main}`]);
    expect(await asked).toEqual({ action: "answer", input: { choice: "yes" } });
    expect(await elsewhere).toEqual({ action: "answer", input: { choice: "yes" } });
    unpollThird();
    expect(await call(first.kernel, input)).toMatchObject({
      kind: "ok",
      content: [{ kind: "text", text: '{"choice":"yes"}' }],
    });
    unpoll();
  });

  it("stops a parked call through its part, and its re-run settles stopped", async () => {
    const seen: string[] = [];

    const parker = {
      name: "parker",
      description: "Wait for a timer.",
      parameters: standard(Type.Object({})),
      class: () => ({ kind: "custom", label: "Waiting" }),
      replay: "safe",
      execute: async (_args, invocation) => {
        const woke = await invocation.wait({ kind: "timer", until: Date.now() + 60_000 });
        seen.push(`${woke.kind} ${invocation.signal.aborted ? "aborted" : "live"}`);

        return { content: [{ kind: "text", text: woke.kind }] };
      },
    } satisfies ToolDefinition<object>;

    const { kernel, host } = await setup({ plugins: [toolPlugin([parker])] });
    const { session } = await host.sessions.start({ content: "Hi." });
    const run = await liveRun(kernel, session.id);
    const notified: string[] = [];
    kernel.wakes.subscribe((woken, head) => notified.push(`${woken}/${head}`));
    const input = { session: session.id, run, call: "w1", name: "parker", args: {} };

    expect(await call(kernel, input)).toEqual({ kind: "parked" });
    expect(await session.part(asId("w1")).act("stop", {})).toEqual({
      kind: "ok",
      output: undefined,
    });
    expect(await readCall(kernel, session.id, "w1")).toMatchObject({
      waiting: null,
      waits: [{ kind: "stopped" }],
      result: null,
    });
    expect(notified).toEqual([`${session.id}/${main}`]);
    expect(await call(kernel, input)).toEqual({ kind: "stopped" });
    expect(seen).toEqual(["stopped aborted"]);
    expect((await toolPart(session, "w1")).state).toMatchObject({
      phase: "settled",
      outcome: { kind: "stopped" },
    });
  });

  it("re-runs a stopping run's owed calls with its signal aborted after a restart", async () => {
    const store = await memoryStore().open();
    const signals: string[] = [];
    const hang = new Promise<never>(() => undefined);

    const flaky = {
      ...echo,
      name: "flaky",
      execute: async (_args, invocation) => {
        signals.push(invocation.signal.aborted ? "aborted" : "live");

        return signals.length === 1 ? hang : { content: [{ kind: "text", text: "done" }] };
      },
    } satisfies ToolDefinition<{ text: string }>;

    const plugins = [toolPlugin([flaky])];
    const first = await setup({ store, plugins });
    const { session } = await first.host.sessions.start({ content: "Go." });
    void first.host.execution.advance({ session: session.id, head: main });
    const run = (await first.script.started(1)).input.run.id;
    void call(first.kernel, {
      session: session.id,
      run,
      call: "f1",
      name: "flaky",
      args: { text: "x" },
    });
    await until(() => (signals.length === 1 ? true : undefined));
    const fenced = await readRun(first.kernel, session.id, run);

    await store.refs.set([
      {
        name: fenced.ref.name,
        target: await store.objects.put(envelope("run", { ...fenced.record, stopping: true }, 0)),
        expect: fenced.ref.revision,
      },
    ]);

    await expireLease(store, session.id, main);
    const second = await setup({ store, plugins });

    expect(await second.host.execution.advance({ session: session.id, head: main })).toEqual({
      kind: "idle",
    });
    expect(signals).toEqual(["live", "aborted"]);
    expect((await readCall(second.kernel, session.id, "f1")).result).toEqual({ kind: "stopped" });
    expect(await second.host.session(session.id).run(run).settled()).toEqual({ kind: "stopped" });
  });
});
